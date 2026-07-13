import db from "./init.js";

/** 최근 N일간 사용한 카테고리 목록 (겹치지 않는 새 주제 추천에 사용) */
export function getRecentCategories(days = 14) {
  const rows = db
    .prepare(
      `SELECT category, COUNT(*) as cnt, MAX(created_at) as last_used
       FROM projects
       WHERE created_at >= datetime('now', ?)
       GROUP BY category
       ORDER BY last_used DESC`
    )
    .all(`-${days} days`);
  return rows;
}

export function getAllPastTopics(limit = 50) {
  return db
    .prepare(`SELECT topic, category, created_at FROM projects ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}

/** 오늘 날짜 기준 특정 서비스의 사용량 합계 (나노바나나 쿼터 체크용) */
export function getTodayUsage(service) {
  const today = new Date().toISOString().slice(0, 10);
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM usage_log WHERE date = ? AND service = ?`)
    .get(today, service);
  return row.total;
}

/** 이번 달 사용량 합계 (TTS 월별 쿼터 체크용) */
export function getMonthUsage(service) {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM usage_log WHERE date LIKE ? AND service = ?`
    )
    .get(`${month}%`, service);
  return row.total;
}

export function logUsage(service, amount = 1, projectId = null) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO usage_log (date, service, amount, project_id) VALUES (?, ?, ?, ?)`).run(
    today,
    service,
    amount,
    projectId
  );
}
