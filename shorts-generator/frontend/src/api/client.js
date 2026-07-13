const BASE = "/api";

/** 백엔드가 반환하는 로컬 파일 경로(윈도우는 \, macOS/Linux는 /)를 /output-files URL로 변환 */
export function toOutputUrl(fullPath) {
  if (!fullPath) return null;
  const normalized = fullPath.replace(/\\/g, "/");
  const marker = "output/";
  const idx = normalized.indexOf(marker);
  if (idx === -1) return null;
  return `/output-files/${normalized.slice(idx + marker.length)}`;
}

async function handle(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "요청 실패");
  }
  return res.json();
}

export const api = {
  recommendTopics: () => fetch(`${BASE}/topics/recommend`).then(handle),

  createProject: (topic, category) =>
    fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, category }),
    }).then(handle),

  getProject: (id) => fetch(`${BASE}/projects/${id}`).then(handle),

  generateSceneImage: (projectId, sceneId, usePro = false) =>
    fetch(`${BASE}/projects/${projectId}/scenes/${sceneId}/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usePro }),
    }).then(handle),

  uploadSceneImage: (projectId, sceneId, imageBase64, mimeType) =>
    fetch(`${BASE}/projects/${projectId}/scenes/${sceneId}/image/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64, mimeType }),
    }).then(handle),

  completeImages: (projectId) =>
    fetch(`${BASE}/projects/${projectId}/images/complete`, { method: "POST" }).then(handle),

  generateNarration: (projectId, sceneId) =>
    fetch(`${BASE}/projects/${projectId}/scenes/${sceneId}/narration`, {
      method: "POST",
    }).then(handle),

  completeNarration: (projectId) =>
    fetch(`${BASE}/projects/${projectId}/narration/complete`, { method: "POST" }).then(handle),

  render: (projectId, musicPath) =>
    fetch(`${BASE}/projects/${projectId}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ musicPath }),
    }).then(handle),

  getQuota: () => fetch(`${BASE}/quota`).then(handle),
};
