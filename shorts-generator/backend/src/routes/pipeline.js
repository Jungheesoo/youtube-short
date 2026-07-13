import { Router } from "express";
import { v4 as uuid } from "uuid";
import path from "path";
import db from "../db/init.js";
import { generateScript, recommendTopics } from "../services/claude.js";
import { generateSceneImage, generateThumbnailImage, getQuotaStatus } from "../services/gemini.js";
import { synthesizeNarration, getTtsQuotaStatus } from "../services/tts.js";
import {
  imageToClip,
  muxClipWithAudio,
  concatClips,
  generateAssSubtitle,
  finalizeWithSubtitlesAndMusic,
  pickDirection,
} from "../services/ffmpeg.js";
import { updateProjectStatus, getProject, getScenes } from "../jobs/pipelineState.js";

const router = Router();
const OUTPUT_ROOT = path.join(process.cwd(), "output");

// --- 1. 주제 추천 ---
router.get("/topics/recommend", async (req, res) => {
  try {
    const topics = await recommendTopics();
    res.json({ topics });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 2. 프로젝트 생성 + 대본 생성 ---
router.post("/projects", async (req, res) => {
  const { topic, category } = req.body;
  if (!topic) return res.status(400).json({ error: "topic이 필요합니다." });

  try {
    const script = await generateScript(topic);
    const projectId = uuid();

    db.prepare(
      `INSERT INTO projects (id, topic, category, status, script_json, title_candidates)
       VALUES (?, ?, ?, 'script_done', ?, ?)`
    ).run(projectId, topic, category || null, JSON.stringify(script), JSON.stringify(script.titleCandidates));

    const insertScene = db.prepare(
      `INSERT INTO scenes (id, project_id, scene_order, narration, image_prompt, duration_sec, scene_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    script.scenes.forEach((s, i) => {
      insertScene.run(uuid(), projectId, i, s.narration, s.imagePrompt, s.durationSec, s.sceneType || "content");
    });

    res.json({ projectId, script });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 3. 씬 이미지 생성 (개별 재생성 지원) ---
router.post("/projects/:id/scenes/:sceneId/image", async (req, res) => {
  const { id, sceneId } = req.params;
  const { usePro } = req.body;

  try {
    const scene = db.prepare(`SELECT * FROM scenes WHERE id = ?`).get(sceneId);
    if (!scene) return res.status(404).json({ error: "씬을 찾을 수 없습니다." });

    const outputPath = path.join(OUTPUT_ROOT, id, `scene_${scene.scene_order}.png`);
    const genFn = usePro ? generateThumbnailImage : generateSceneImage;
    await genFn(scene.image_prompt, outputPath);

    db.prepare(
      `UPDATE scenes SET image_path = ?, regenerate_count = regenerate_count + 1 WHERE id = ?`
    ).run(outputPath, sceneId);

    res.json({ imagePath: outputPath, quota: getQuotaStatus() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 4. 프로젝트 전체 이미지 완료 처리 ---
router.post("/projects/:id/images/complete", (req, res) => {
  updateProjectStatus(req.params.id, "images_done");
  res.json({ ok: true });
});

// --- 5. 나레이션 생성 (씬별) ---
router.post("/projects/:id/scenes/:sceneId/narration", async (req, res) => {
  const { id, sceneId } = req.params;
  try {
    const scene = db.prepare(`SELECT * FROM scenes WHERE id = ?`).get(sceneId);
    const outputPath = path.join(OUTPUT_ROOT, id, `scene_${scene.scene_order}.mp3`);
    await synthesizeNarration(scene.narration, outputPath);
    db.prepare(`UPDATE scenes SET audio_path = ? WHERE id = ?`).run(outputPath, sceneId);
    res.json({ audioPath: outputPath, quota: getTtsQuotaStatus() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/projects/:id/narration/complete", (req, res) => {
  updateProjectStatus(req.params.id, "narration_done");
  res.json({ ok: true });
});

// --- 6. 최종 합성 ---
router.post("/projects/:id/render", async (req, res) => {
  const { id } = req.params;
  const { musicPath } = req.body; // Pixabay/유튜브 오디오 라이브러리에서 다운로드한 로컬 파일 경로
  const workDir = path.join(OUTPUT_ROOT, id);

  try {
    const scenes = getScenes(id);
    const clipPaths = [];

    let previousDirection = null;
    for (const scene of scenes) {
      const rawClip = path.join(workDir, `clip_raw_${scene.scene_order}.mp4`);
      const muxedClip = path.join(workDir, `clip_${scene.scene_order}.mp4`);
      // 오프닝 씬은 시선을 중심 오브젝트로 끌어당기는 zoom-in 고정, 이후 씬은 직전과 다른 방향으로 순회
      const direction = scene.scene_order === 0 ? "zoom-in" : pickDirection(previousDirection);
      await imageToClip(scene.image_path, scene.duration_sec, rawClip, direction);
      await muxClipWithAudio(rawClip, scene.audio_path, muxedClip);
      clipPaths.push(muxedClip);
      previousDirection = direction;
    }

    const concatenated = path.join(workDir, "concatenated.mp4");
    await concatClips(clipPaths, concatenated, workDir);

    // 자막 타이밍은 씬 duration을 누적해 근사치로 생성 (정밀 타이밍은 TTS timestamp 연동 후 개선 권장)
    let cursor = 0;
    const timings = scenes.map((s) => {
      const t = { text: s.narration, startSec: cursor, endSec: cursor + s.duration_sec };
      cursor += s.duration_sec;
      return t;
    });
    const assPath = path.join(workDir, "subtitles.ass");
    generateAssSubtitle(timings, assPath);

    const finalPath = path.join(workDir, "final.mp4");
    await finalizeWithSubtitlesAndMusic(concatenated, assPath, musicPath, finalPath);

    db.prepare(`UPDATE projects SET video_path = ?, music_track = ?, status = 'rendered' WHERE id = ?`).run(
      finalPath,
      musicPath || null,
      id
    );

    res.json({ videoPath: finalPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 7. 프로젝트/씬 조회 ---
router.get("/projects/:id", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "not found" });
  res.json({ project, scenes: getScenes(req.params.id) });
});

// --- 8. 쿼터 대시보드 ---
router.get("/quota", (req, res) => {
  res.json({ ...getQuotaStatus(), tts: getTtsQuotaStatus() });
});

export default router;
