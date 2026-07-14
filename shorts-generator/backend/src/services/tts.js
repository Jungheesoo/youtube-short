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
    // 남성 보이스, Chirp3-HD 등급(Neural2보다 최신/자연스러움, 무료 한도는 Neural2와 동일하게 월
    // 100만자 — 2026-07 Cloud TTS pricing 페이지로 확인). Neural2엔 남성 보이스가 "C" 하나뿐이라
    // "더 중저음" 비교 대상이 없어서 Chirp3-HD로 등급을 올림. 정확한 음색(어느 게 제일 중저음인지)은
    // 실제로 들어봐야 확인 가능 — 미검증. 남성 보이스 다른 후보: ko-KR-Chirp3-HD-Fenrir,
    // ko-KR-Chirp3-HD-Enceladus, ko-KR-Chirp3-HD-Iapetus, ko-KR-Chirp3-HD-Orus (전부 listVoices API로
    // 남성 확인됨, ffmpeg.js 관련 없음)
    voice: { languageCode: "ko-KR", name: "ko-KR-Chirp3-HD-Charon" },
    audioConfig: { audioEncoding: "MP3", speakingRate: 1.15 },
    enableTimePointing: ["SSML_MARK"], // word-level 타이밍이 필요하면 SSML <mark> 태그 활용 권장
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, response.audioContent, "binary");

  logUsage("tts_chars", charCount);
  return outputPath;
}
