import { Router } from "express";
import { v4 as uuid } from "uuid";
import path from "path";
import fs from "fs";
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
  getAudioDuration,
} from "../services/ffmpeg.js";
import { updateProjectStatus, getProject, getScenes } from "../jobs/pipelineState.js";
import { getVoiceSettings, setVoiceSetting } from "../db/queries.js";
import { logError } from "../utils/logger.js";

const router = Router();
const OUTPUT_ROOT = path.join(process.cwd(), "output");

// 채널 고정 테마곡 — 모든 영상에 항상 동일한 곡을 사용한다.
// 현재 파일명("soundgalleryby-emotional-cinematic-background-piano-inspirational-orchestral-music-115915")
// 으로 미루어 SoundGallery 계열 스톡 음원으로 보이나 실제 라이선스 조건(크레딧 표기 의무 등)은 미검증 —
// 출처 페이지에서 라이선스를 직접 확인하고, 크레딧 표기가 필요하면 영상 설명란/고정 댓글에 직접 추가할 것
// (코드가 자동으로 넣어주지 않음).
const MUSIC_PATH = path.join(process.cwd(), "assets/music/theme_music.mp3");

// --- 1. 주제 추천 ---
router.get("/topics/recommend", async (req, res) => {
  try {
    const topics = await recommendTopics();
    res.json({ topics });
  } catch (e) {
    logError("GET /topics/recommend", e);
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
      `INSERT INTO projects (id, topic, category, status, script_json, title_candidates, description, style_guide, pinned_comment)
       VALUES (?, ?, ?, 'script_done', ?, ?, ?, ?, ?)`
    ).run(
      projectId,
      topic,
      category || null,
      JSON.stringify(script),
      JSON.stringify(script.titleCandidates),
      script.description || null,
      null, // style_guide: 화풍은 STORYBOOK_STYLE로 고정, 더 이상 씬별로 생성하지 않음 (claude.js 참고)
      script.pinnedComment || null
    );

    const insertScene = db.prepare(
      `INSERT INTO scenes (id, project_id, scene_order, narration, image_prompt, duration_sec, scene_type, speaker)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    script.scenes.forEach((s, i) => {
      insertScene.run(
        uuid(),
        projectId,
        i,
        s.narration,
        s.imagePrompt,
        s.durationSec,
        s.sceneType || "content",
        s.speaker || "narrator"
      );
    });

    res.json({ projectId, script });
  } catch (e) {
    logError("POST /projects", e);
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
    logError(`POST /projects/${id}/scenes/${sceneId}/image`, e);
    res.status(500).json({ error: e.message });
  }
});

// --- 3-1. 씬 이미지 수동 업로드 (AI Studio/Gemini 앱에서 무료로 생성한 이미지를 붙여넣기) ---
router.post("/projects/:id/scenes/:sceneId/image/upload", (req, res) => {
  const { id, sceneId } = req.params;
  const { imageBase64, mimeType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: "imageBase64가 필요합니다." });

  try {
    const scene = db.prepare(`SELECT * FROM scenes WHERE id = ?`).get(sceneId);
    if (!scene) return res.status(404).json({ error: "씬을 찾을 수 없습니다." });

    const ext = mimeType === "image/jpeg" ? "jpg" : "png";
    const outputPath = path.join(OUTPUT_ROOT, id, `scene_${scene.scene_order}.${ext}`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(imageBase64, "base64"));

    db.prepare(
      `UPDATE scenes SET image_path = ?, regenerate_count = regenerate_count + 1 WHERE id = ?`
    ).run(outputPath, sceneId);

    res.json({ imagePath: outputPath });
  } catch (e) {
    logError(`POST /projects/${id}/scenes/${sceneId}/image/upload`, e);
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

    const voiceSettings = getVoiceSettings();
    const voiceName = voiceSettings[scene.speaker || "narrator"];
    const { captionChunks } = await synthesizeNarration(scene.narration, outputPath, voiceName);

    let resolvedChunks = captionChunks;
    if (captionChunks.some((c) => c.isRatio)) {
      const durationSec = await getAudioDuration(outputPath);
      resolvedChunks = captionChunks.map((c) => ({
        text: c.text,
        startSec: c.isRatio ? c.startSec * durationSec : c.startSec,
      }));
    }

    db.prepare(`UPDATE scenes SET audio_path = ?, caption_chunks = ? WHERE id = ?`).run(
      outputPath,
      JSON.stringify(resolvedChunks),
      sceneId
    );
    res.json({ audioPath: outputPath, quota: getTtsQuotaStatus() });
  } catch (e) {
    logError(`POST /projects/${id}/scenes/${sceneId}/narration`, e);
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
  // title: 미지정 시 titleCandidates[0] 사용. 배경음악은 항상 MUSIC_PATH(채널 고정 테마곡) 사용.
  const { title } = req.body;
  const workDir = path.join(OUTPUT_ROOT, id);

  try {
    const project = getProject(id);
    if (!project) return res.status(404).json({ error: "프로젝트를 찾을 수 없습니다." });

    const scenes = getScenes(id);
    const missing = scenes.filter((s) => !s.image_path || !s.audio_path);
    if (missing.length > 0) {
      const orders = missing.map((s) => s.scene_order + 1).join(", ");
      throw new Error(`이미지 또는 나레이션이 없는 씬이 있습니다 (#${orders}). 이전 단계에서 모두 채운 뒤 다시 시도하세요.`);
    }

    // 씬별 실제 TTS 오디오 길이를 측정 — 영상 클립 길이/자막 타이밍 모두 이 값을 기준으로 삼아
    // 화면전환/자막이 실제 나레이션과 어긋나지 않게 한다 (script의 duration_sec는 추정치일 뿐).
    const realDurations = [];
    for (const scene of scenes) {
      realDurations.push(await getAudioDuration(scene.audio_path));
    }

    const clipPaths = [];
    let previousDirection = null;
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const duration = realDurations[i];
      const rawClip = path.join(workDir, `clip_raw_${scene.scene_order}.mp4`);
      const muxedClip = path.join(workDir, `clip_${scene.scene_order}.mp4`);
      // 오프닝 씬은 시선을 중심 오브젝트로 끌어당기는 zoom-in 고정, 이후 씬은 직전과 다른 방향으로 순회
      const direction = scene.scene_order === 0 ? "zoom-in" : pickDirection(previousDirection);
      await imageToClip(scene.image_path, duration, rawClip, direction);
      await muxClipWithAudio(rawClip, scene.audio_path, muxedClip);
      clipPaths.push(muxedClip);
      previousDirection = direction;
    }

    const concatenated = path.join(workDir, "concatenated.mp4");
    await concatClips(clipPaths, concatenated, workDir);

    // 자막 타이밍도 실제 오디오 길이를 누적해서 계산 (영상 클립 길이와 동일한 기준).
    // 씬에 caption_chunks(2줄 자막 청크별 상대 시작 시각)가 있으면 청크 단위로 펼쳐서 절대시각으로
    // 변환하고, 없으면(구 데이터 등) 기존처럼 나레이션 전체를 한 블록으로 폴백한다.
    let cursor = 0;
    const timings = [];
    scenes.forEach((s, i) => {
      const duration = realDurations[i];
      let chunks = [];
      try {
        chunks = s.caption_chunks ? JSON.parse(s.caption_chunks) : [];
      } catch {
        chunks = [];
      }

      if (chunks.length > 0) {
        chunks.forEach((c, ci) => {
          const startSec = cursor + c.startSec;
          const endSec = ci + 1 < chunks.length ? cursor + chunks[ci + 1].startSec : cursor + duration;
          timings.push({ text: c.text, startSec, endSec });
        });
      } else {
        timings.push({ text: s.narration, startSec: cursor, endSec: cursor + duration });
      }

      cursor += duration;
    });
    // 상단바 제목: 요청에서 override가 없으면 titleCandidates[0].title 사용
    // (title_candidates는 { title, hashtags } 객체 배열 — 작업 9)
    let titleCandidates = [];
    try {
      titleCandidates = JSON.parse(project.title_candidates || "[]");
    } catch {
      titleCandidates = [];
    }
    const barTitle = title || titleCandidates[0]?.title || project.topic;

    const assPath = path.join(workDir, "subtitles.ass");
    generateAssSubtitle(timings, assPath, { title: barTitle, totalDurationSec: cursor });

    const finalPath = path.join(workDir, "final.mp4");
    await finalizeWithSubtitlesAndMusic(concatenated, assPath, MUSIC_PATH, finalPath);

    db.prepare(`UPDATE projects SET video_path = ?, music_track = ?, status = 'rendered' WHERE id = ?`).run(
      finalPath,
      MUSIC_PATH,
      id
    );

    res.json({ videoPath: finalPath });
  } catch (e) {
    logError(`POST /projects/${id}/render`, e);
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

// --- 9. 에러 로그 조회 (클로드에게 붙여넣기용) ---
router.get("/logs/error", (req, res) => {
  const logPath = path.join(process.cwd(), "logs", "error.log");
  if (!fs.existsSync(logPath)) return res.json({ log: "" });
  const content = fs.readFileSync(logPath, "utf-8");
  res.json({ log: content.slice(-20000) }); // 너무 길면 최근 부분만
});

// --- 10. 화자별 보이스 설정 ---
router.get("/voice-settings", (req, res) => {
  res.json(getVoiceSettings());
});

router.put("/voice-settings", (req, res) => {
  const { narrator, characterA, characterB } = req.body;
  try {
    if (narrator) setVoiceSetting("narrator", narrator);
    if (characterA) setVoiceSetting("characterA", characterA);
    if (characterB) setVoiceSetting("characterB", characterB);
    res.json(getVoiceSettings());
  } catch (e) {
    logError("PUT /voice-settings", e);
    res.status(500).json({ error: e.message });
  }
});

const VOICE_PREVIEW_TEXT = "안녕하세요, 이 목소리는 이렇게 들립니다.";
const VOICE_NAME_PATTERN = /^[A-Za-z0-9-]+$/;

router.post("/voice-settings/preview", async (req, res) => {
  const { voiceName } = req.body;
  if (!voiceName || !VOICE_NAME_PATTERN.test(voiceName)) {
    return res.status(400).json({ error: "voiceName이 올바르지 않습니다." });
  }
  try {
    const previewPath = path.join(OUTPUT_ROOT, "voice-preview", `${voiceName}.mp3`);
    if (!fs.existsSync(previewPath)) {
      await synthesizeNarration(VOICE_PREVIEW_TEXT, previewPath, voiceName);
    }
    res.json({ audioPath: previewPath });
  } catch (e) {
    logError("POST /voice-settings/preview", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
