import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, toOutputUrl } from "../api/client.js";

// 모든 영상에 고정으로 쓰는 댓글. 매번 새로 생성하지 않고 채널 톤에 맞춰 고정 문구로 둔다.
const PINNED_COMMENT = `오늘 이 이야기가, 지쳐있던 누군가의 마음에 작은 쉼표가 되었으면 합니다.
여러분은 오늘 어떤 하루를 보내셨나요? 댓글로 편하게 나눠주세요 🤍`;

export default function RenderPage() {
  const { id } = useParams();
  const [rendering, setRendering] = useState(false);
  const [videoPath, setVideoPath] = useState(null);
  const [musicPath, setMusicPath] = useState("");
  const [error, setError] = useState(null);
  const [checkedImages, setCheckedImages] = useState(false);
  const [checkedNarration, setCheckedNarration] = useState(false);
  const [titleCandidates, setTitleCandidates] = useState([]);
  const [description, setDescription] = useState("");
  const [copied, setCopied] = useState(null);
  const [errorLog, setErrorLog] = useState(null);

  useEffect(() => {
    api.getProject(id).then(({ project }) => {
      try {
        setTitleCandidates(JSON.parse(project.title_candidates || "[]"));
      } catch {
        setTitleCandidates([]);
      }
      setDescription(project.description || "");
    });
  }, [id]);

  async function copyText(key, text) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  async function handleRender() {
    setRendering(true);
    setError(null);
    setErrorLog(null);
    try {
      const { videoPath } = await api.render(id, musicPath || undefined);
      setVideoPath(videoPath);
    } catch (e) {
      setError(e.message);
    } finally {
      setRendering(false);
    }
  }

  async function loadErrorLog() {
    const { log } = await api.getErrorLog();
    setErrorLog(log || "(로그가 비어있습니다)");
  }

  return (
    <div className="page">
      <h1>합성 / 미리보기</h1>
      {error && (
        <div>
          <p className="error">{error}</p>
          <button onClick={loadErrorLog}>에러 로그 보기</button>
        </div>
      )}
      {errorLog !== null && (
        <div className="description-box">
          <pre>{errorLog}</pre>
          <button onClick={() => copyText("errorLog", errorLog)}>
            {copied === "errorLog" ? "복사됨!" : "로그 전체 복사 (클로드에게 붙여넣기)"}
          </button>
        </div>
      )}

      <label>
        배경음악 파일 경로 (비워두면 고정 배경음악 "Lullaby" by JVNA 자동 사용 — 다른 곡을 쓰려면 직접 입력)
        <input
          type="text"
          placeholder="비워두면 기본 배경음악 사용"
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
          <video controls src={toOutputUrl(videoPath)} />
          <p>파일 위치: {videoPath}</p>
          <p className="tip">업로드 전에 제목/썸네일/자막을 한 번 더 확인하세요.</p>

          <div className="upload-meta">
            <h3>제목 후보</h3>
            <ul className="title-candidate-list">
              {titleCandidates.map((candidate, i) => {
                const fullText = [candidate.title, ...(candidate.hashtags || [])].join(" ");
                return (
                  <li key={i}>
                    <span>
                      {candidate.title}
                      {candidate.hashtags?.length > 0 && (
                        <span className="hashtags"> {candidate.hashtags.join(" ")}</span>
                      )}
                    </span>
                    <button onClick={() => copyText(`title-${i}`, fullText)}>
                      {copied === `title-${i}` ? "복사됨!" : "복사"}
                    </button>
                  </li>
                );
              })}
            </ul>

            <h3>설명</h3>
            <div className="description-box">
              <pre>{description}</pre>
              <button onClick={() => copyText("description", description)}>
                {copied === "description" ? "복사됨!" : "설명 복사"}
              </button>
            </div>

            <h3>고정 댓글</h3>
            <div className="description-box">
              <pre>{PINNED_COMMENT}</pre>
              <button onClick={() => copyText("pinnedComment", PINNED_COMMENT)}>
                {copied === "pinnedComment" ? "복사됨!" : "댓글 복사"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
