import db from "../db/init.js";

export const STATES = [
  "draft",
  "script_done",
  "images_done",
  "narration_done",
  "rendered",
  "uploaded",
];

/** 실패해도 마지막 성공 상태부터 재시도할 수 있도록 상태를 갱신 */
export function updateProjectStatus(projectId, status) {
  if (!STATES.includes(status)) throw new Error(`알 수 없는 상태: ${status}`);
  db.prepare(`UPDATE projects SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    status,
    projectId
  );
}

export function getProject(projectId) {
  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId);
}

export function getScenes(projectId) {
  return db
    .prepare(`SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_order ASC`)
    .all(projectId);
}
