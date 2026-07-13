import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client.js";

export default function RenderPage() {
  const { id } = useParams();
  const [rendering, setRendering] = useState(false);
  const [videoPath, setVideoPath] = useState(null);
  const [musicPath, setMusicPath] = useState("");
  const [error, setError] = useState(null);
  const [checkedImages, setCheckedImages] = useState(false);
  const [checkedNarration, setCheckedNarration] = useState(false);

  async function handleRender() {
    setRendering(true);
    setError(null);
    try {
      const { videoPath } = await api.render(id, musicPath || undefined);
      setVideoPath(videoPath);
    } catch (e) {
      setError(e.message);
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="page">
      <h1>합성 / 미리보기</h1>
      {error && <p className="error">{error}</p>}

      <label>
        배경음악 파일 경로 (Pixabay/유튜브 오디오 라이브러리에서 다운로드한 로컬 mp3)
        <input
          type="text"
          placeholder="/path/to/music.mp3"
          value={musicPath}
          onChange={(e) => setMusicPath(e.target.value)}
        />
      </label>

      <div className="curation-checklist">
        <label>
          <input
            type="checkbox"
            checked={checkedImages}
            onChange={(e) => setCheckedImages(e.target.checked)}
          />
          이미지 재생성 여부를 확인했습니다
        </label>
        <label>
          <input
            type="checkbox"
            checked={checkedNarration}
            onChange={(e) => setCheckedNarration(e.target.checked)}
          />
          자막/나레이션 내용을 확인했습니다
        </label>
      </div>

      <button onClick={handleRender} disabled={rendering || !checkedImages || !checkedNarration}>
        {rendering ? "렌더링 중... (몇 분 소요될 수 있음)" : "최종 영상 렌더링"}
      </button>

      {videoPath && (
        <div className="preview">
          <h2>완성!</h2>
          <video controls src={`/output-files/${videoPath.split("output/")[1]}`} />
          <p>파일 위치: {videoPath}</p>
          <p className="tip">업로드 전에 제목/썸네일/자막을 한 번 더 확인하세요.</p>
        </div>
      )}
    </div>
  );
}
