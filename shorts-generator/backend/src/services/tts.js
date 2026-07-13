import textToSpeech from "@google-cloud/text-to-speech";
import fs from "fs";
import path from "path";
import { getMonthUsage, logUsage } from "../db/queries.js";

const client = new textToSpeech.TextToSpeechClient();
const MONTHLY_LIMIT = Number(process.env.TTS_MONTHLY_CHAR_LIMIT || 1000000);

export function getTtsQuotaStatus() {
  return { used: getMonthUsage("tts_chars"), limit: MONTHLY_LIMIT };
}

/**
 * 나레이션 텍스트를 SSML로 감싸서 자연스러운 pause를 추가.
 * 반전 포인트(마지막 문장) 앞에 약간의 정적을 넣는다.
 */
function toSSML(text, { pauseBeforeLastMs = 400 } = {}) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return `<speak>${text}</speak>`;

  const last = sentences.pop();
  const body = sentences.join(" ");
  return `<speak>${body}<break time="${pauseBeforeLastMs}ms"/>${last}</speak>`;
}

/**
 * 나레이션을 음성으로 합성. word-level timestamp를 함께 반환해
 * FFmpeg 자막 타이밍 자동 생성에 사용한다.
 */
export async function synthesizeNarration(text, outputPath) {
  const charCount = text.length;
  const used = getMonthUsage("tts_chars");
  if (used + charCount > MONTHLY_LIMIT) {
    throw new Error("TTS 월간 무료 쿼터 초과 예상. 이번 달은 사용을 자제하세요.");
  }

  const [response] = await client.synthesizeSpeech({
    input: { ssml: toSSML(text) },
    voice: { languageCode: "ko-KR", name: "ko-KR-Neural2-C" }, // 원하는 보이스로 교체 가능
    audioConfig: { audioEncoding: "MP3", speakingRate: 1.05 },
    enableTimePointing: ["SSML_MARK"], // word-level 타이밍이 필요하면 SSML <mark> 태그 활용 권장
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, response.audioContent, "binary");

  logUsage("tts_chars", charCount);
  return outputPath;
}
