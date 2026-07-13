import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, "../../shorts.db"));

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  category TEXT,               -- 예: 삼국시대, 조선시대, 판타지 등 (추천 로직에 사용)
  status TEXT NOT NULL DEFAULT 'draft',
  -- draft -> script_done -> images_done -> narration_done -> rendered -> uploaded
  script_json TEXT,            -- Claude가 생성한 씬 구조 JSON
  title_candidates TEXT,       -- 제목 후보 JSON 배열
  music_track TEXT,            -- 사용한 배경음악 출처 기록 (저작권 대응용)
  video_path TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  scene_order INTEGER NOT NULL,
  narration TEXT,
  image_prompt TEXT,
  image_path TEXT,
  audio_path TEXT,
  duration_sec REAL,
  regenerate_count INTEGER DEFAULT 0,
  scene_type TEXT DEFAULT 'content'  -- 'content' | 'outro'
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,          -- YYYY-MM-DD, 일별 쿼터 집계용
  service TEXT NOT NULL,       -- 'nanobanana' | 'nanobanana_pro' | 'tts_chars' | 'claude'
  amount INTEGER NOT NULL DEFAULT 1,
  project_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_date_service ON usage_log(date, service);
CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category);
`);

// 기존에 scene_type 컬럼 없이 생성된 shorts.db가 있을 경우를 대비한 안전 마이그레이션
const sceneColumns = db.prepare(`PRAGMA table_info(scenes)`).all();
if (!sceneColumns.some((c) => c.name === "scene_type")) {
  db.exec(`ALTER TABLE scenes ADD COLUMN scene_type TEXT DEFAULT 'content'`);
}

export default db;
