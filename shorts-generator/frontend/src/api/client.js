const BASE = "/api";

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
