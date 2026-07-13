import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";

export default function ImagePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [scenes, setScenes] = useState([]);
  const [quota, setQuota] = useState(null);
  const [regenerating, setRegenerating] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { scenes } = await api.getProject(id);
    setScenes(scenes);
    const q = await api.getQuota();
    setQuota(q);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function regenerate(sceneId, usePro = false) {
    setRegenerating(sceneId);
    setError(null);
    try {
      await api.generateSceneImage(id, sceneId, usePro);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRegenerating(null);
    }
  }

  async function handleNext() {
    await api.completeImages(id);
    navigate(`/projects/${id}/narration`);
  }

  return (
    <div className="page">
      <h1>컷별 이미지</h1>

      {quota && (
        <div className="quota-bar">
          <span>나노바나나: {quota.nanobanana.used} / {quota.nanobanana.limit}</span>
          <span>나노바나나 프로: {quota.nanobananaPro.used} / {quota.nanobananaPro.limit}</span>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className="scene-grid">
        {scenes.map((scene) => (
          <div key={scene.id} className="scene-card">
            <span className="scene-order">#{scene.scene_order + 1}</span>
            {scene.scene_type === "outro" && <span className="outro-badge">아웃트로</span>}
            {scene.image_path ? (
              <img src={`/output-files/${scene.image_path.split("output/")[1]}`} alt="" />
            ) : (
              <div className="placeholder">이미지 없음</div>
            )}
            <p className="narration-preview">{scene.narration}</p>
            <div className="scene-actions">
              <button disabled={regenerating === scene.id} onClick={() => regenerate(scene.id, false)}>
                {regenerating === scene.id ? "생성 중..." : "재생성"}
              </button>
              <button disabled={regenerating === scene.id} onClick={() => regenerate(scene.id, true)}>
                프로로 재생성
              </button>
            </div>
          </div>
        ))}
      </div>

      <button className="next-button" onClick={handleNext}>
        다음: 나레이션 생성 →
      </button>
    </div>
  );
}
