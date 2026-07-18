// 나레이션을 "2줄 자막 청크" 단위로 분할 — 한 이미지가 떠 있는 동안 자막만 2줄씩 갈아끼우는
// 연출을 위해 tts.js(SSML mark 삽입)와 pipeline.js(렌더 시 청크별 타이밍 배치)가 함께 사용한다.
//
// maxCharsPerLine=13은 실제 렌더링 스크린샷(Caption 스타일, Fontsize 68)에서 한 줄에 들어간
// 글자 수를 육안으로 센 근사치 — 미검증 근사치이므로 실제 렌더 결과 보고 조정 필요.
const DEFAULT_MAX_CHARS_PER_LINE = 13;
const DEFAULT_LINES_PER_CHUNK = 2;

function wrapIntoLines(text, maxCharsPerLine) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  return lines;
}

export function splitNarrationIntoChunks(
  text,
  maxCharsPerLine = DEFAULT_MAX_CHARS_PER_LINE,
  linesPerChunk = DEFAULT_LINES_PER_CHUNK
) {
  const lines = wrapIntoLines(text, maxCharsPerLine);
  if (lines.length === 0) return [];

  // 마지막 청크가 linesPerChunk를 못 채우고 짧게 남으면(예: 마지막 한 줄만 "떠오른다") 문장이 뚝
  // 끊긴 것처럼 어색해 보인다 — 남는 줄(들)을 직전 줄에 이어붙여서 항상 온전한 문장 단위로 끝나게 한다.
  const remainder = lines.length % linesPerChunk;
  if (remainder !== 0 && lines.length > remainder) {
    const orphanLines = lines.splice(lines.length - remainder, remainder);
    lines[lines.length - 1] = `${lines[lines.length - 1]} ${orphanLines.join(" ")}`;
  }

  const chunks = [];
  for (let i = 0; i < lines.length; i += linesPerChunk) {
    chunks.push(lines.slice(i, i + linesPerChunk).join("\n"));
  }
  return chunks;
}
