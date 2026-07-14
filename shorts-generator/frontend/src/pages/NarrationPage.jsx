import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, toOutputUrl } from "../api/client.js";

export default function NarrationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [scenes, setScenes] = useState([]);
  const [generating, setGenerating] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { scenes } = await api.getProject(id);
    setScenes(scenes);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function generateOne(sceneId) {
    setGenerating(sceneId);
    setError(null);
    try {
      await api.generateNarration(id, sceneId);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(null);
    }
  }

  async function generateAll() {
    for (const scene of scenes) {
      if (!scene.audio_path) await generateOne(scene.id);
    }
  }

  async function handleNext() {
    await api.completeNarration(id);
    navigate(`/projects/${id}/render`);
  }

  const allDone = scenes.length > 0 && scenes.every((s) => s.audio_path);

  return (
    <div className="page">
      <h1>나레이션 생성</h1>
      {error && <p className="error">{error}</p>}

      <button onClick={generateAll} disabled={!!generating}>
        전체 씬 나레이션 생성
      </button>

      <ul className="narration-list">
        {scenes.map((scene) => (
          <li key={scene.id} className={scene.audio_path ? "done" : ""}>
            <span>#{scene.scene_order + 1}</span>
            {scene.scene_type === "outro" && <span className="outro-badge">아웃트로</span>}
            <p>{scene.narration}</p>
            {scene.audio_path && <audio controls src={toOutputUrl(scene.audio_path)} />}
            <button disabled={generating === scene.id} onClick={() => generateOne(scene.id)}>
              {generating === scene.id ? "생성 중..." : scene.audio_path ? "다시 생성" : "생성"}
            </button>
          </li>
        ))}
      </ul>

      <button className="next-button" disabled={!allDone} onClick={handleNext}>
        다음: 합성/미리보기 →
      </button>
    </div>
  );
}
