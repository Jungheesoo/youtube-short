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
  description TEXT,            -- 유튜브 설명란용 텍스트
  pinned_comment TEXT,          -- 채널 고정 댓글 텍스트 (영상마다 새로 생성)
  style_guide TEXT,             -- Claude가 주제에 맞춰 매번 결정한 아트 스타일 문구 (모든 씬 imagePrompt에 공통 삽입)
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
  scene_type TEXT DEFAULT 'content',  -- 'content' | 'outro'
  speaker TEXT DEFAULT 'narrator',    -- 'narrator' | 'characterA' | 'characterB' 등
  caption_chunks TEXT                 -- 자막 청크 [{text, startSec}] JSON (tts.js synthesizeNarration 결과)
);

CREATE TABLE IF NOT EXISTS voice_settings (
  speaker TEXT PRIMARY KEY,
  voice_name TEXT NOT NULL
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

// 기존에 description 컬럼 없이 생성된 shorts.db가 있을 경우를 대비한 안전 마이그레이션
const projectColumns = db.prepare(`PRAGMA table_info(projects)`).all();
if (!projectColumns.some((c) => c.name === "description")) {
  db.exec(`ALTER TABLE projects ADD COLUMN description TEXT`);
}

// 기존에 style_guide 컬럼 없이 생성된 shorts.db가 있을 경우를 대비한 안전 마이그레이션
if (!projectColumns.some((c) => c.name === "style_guide")) {
  db.exec(`ALTER TABLE projects ADD COLUMN style_guide TEXT`);
}

// 기존에 pinned_comment 컬럼 없이 생성된 shorts.db가 있을 경우를 대비한 안전 마이그레이션
if (!projectColumns.some((c) => c.name === "pinned_comment")) {
  db.exec(`ALTER TABLE projects ADD COLUMN pinned_comment TEXT`);
}

// 기존에 speaker/caption_chunks 컬럼 없이 생성된 shorts.db가 있을 경우를 대비한 안전 마이그레이션
if (!sceneColumns.some((c) => c.name === "speaker")) {
  db.exec(`ALTER TABLE scenes ADD COLUMN speaker TEXT DEFAULT 'narrator'`);
}
if (!sceneColumns.some((c) => c.name === "caption_chunks")) {
  db.exec(`ALTER TABLE scenes ADD COLUMN caption_chunks TEXT`);
}

// 화자별 보이스 기본값 시드 — narrator는 채널 확정 보이스(SSML mark 타임포인팅 지원 필수, Chirp3-HD는
// SSML 자체를 지원하지 않아 자막 청크 타이밍이 항상 폴백되는 문제가 있어 Wavenet-D로 교체함, 2026-07-17),
// characterA/B는 미검증(사람이 미리듣기로 확인 후 교체 예정)
db.prepare(`INSERT OR IGNORE INTO voice_settings (speaker, voice_name) VALUES (?, ?)`).run(
  "narrator",
  "ko-KR-Wavenet-D"
);
db.prepare(`INSERT OR IGNORE INTO voice_settings (speaker, voice_name) VALUES (?, ?)`).run(
  "characterA",
  "ko-KR-Neural2-A" // 미검증
);
db.prepare(`INSERT OR IGNORE INTO voice_settings (speaker, voice_name) VALUES (?, ?)`).run(
  "characterB",
  "ko-KR-Neural2-C" // 미검증
);

export default db;
