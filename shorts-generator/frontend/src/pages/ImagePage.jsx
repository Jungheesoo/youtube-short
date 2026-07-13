import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, toOutputUrl } from "../api/client.js";

const AI_STUDIO_URL = "https://aistudio.google.com/";

export default function ImagePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [scenes, setScenes] = useState([]);
  const [uploading, setUploading] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const { scenes } = await api.getProject(id);
    setScenes(scenes);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function copyPrompt(sceneId, prompt) {
    await navigator.clipboard.writeText(prompt);
    setCopiedId(sceneId);
    setTimeout(() => setCopiedId(null), 1500);
  }

  function handleFileSelect(sceneId, file) {
    if (!file) return;
    setUploading(sceneId);
    setError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result.split(",")[1];
        await api.uploadSceneImage(id, sceneId, base64, file.type);
        await load();
      } catch (e) {
        setError(e.message);
      } finally {
        setUploading(null);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleNext() {
    await api.completeImages(id);
    navigate(`/projects/${id}/narration`);
  }

  const allImagesDone = scenes.length > 0 && scenes.every((s) => s.image_path);

  return (
    <div className="page">
      <h1>컷별 이미지</h1>

      <p className="tip">
        Gemini API 결제 없이 무료로 진행 중입니다. 아래 프롬프트를 복사해{" "}
        <a href={AI_STUDIO_URL} target="_blank" rel="noreferrer">
          Google AI Studio
        </a>
        (하루 약 500장 무료)에서 이미지를 생성한 뒤 다운로드해서 업로드하세요.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="scene-grid">
        {scenes.map((scene) => (
          <div key={scene.id} className="scene-card">
            <span className="scene-order">#{scene.scene_order + 1}</span>
            {scene.scene_type === "outro" && <span className="outro-badge">아웃트로</span>}
            {scene.image_path ? (
              <img src={toOutputUrl(scene.image_path)} alt="" />
            ) : (
              <div className="placeholder">이미지 없음</div>
            )}
            <p className="narration-preview">{scene.narration}</p>
            <p className="prompt-preview">{scene.image_prompt}</p>
            <div className="scene-actions">
              <button onClick={() => copyPrompt(scene.id, scene.image_prompt)}>
                {copiedId === scene.id ? "복사됨!" : "프롬프트 복사"}
              </button>
              <label className="upload-button">
                {uploading === scene.id ? "업로드 중..." : "이미지 업로드"}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  disabled={uploading === scene.id}
                  onChange={(e) => handleFileSelect(scene.id, e.target.files?.[0])}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <button className="next-button" disabled={!allImagesDone} onClick={handleNext}>
        {allImagesDone ? "다음: 나레이션 생성 →" : `이미지 업로드 필요 (${scenes.filter((s) => s.image_path).length}/${scenes.length})`}
      </button>
    </div>
  );
}
