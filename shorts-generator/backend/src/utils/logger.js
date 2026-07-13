import fs from "fs";
import path from "path";

const LOG_PATH = path.join(process.cwd(), "logs", "error.log");

/**
 * 에러를 콘솔 + logs/error.log에 함께 남긴다.
 * error.log는 클로드에게 그대로 복사-붙여넣기 하기 좋은 형태로 저장.
 */
export function logError(context, error) {
  const entry = [
    `\n[${new Date().toISOString()}] ${context}`,
    `message: ${error.message}`,
    error.status ? `status: ${error.status}` : null,
    error.stack ? `stack:\n${error.stack}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  console.error(entry);

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, entry + "\n");
}
