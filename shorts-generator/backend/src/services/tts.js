import textToSpeech from "@google-cloud/text-to-speech";
import fs from "fs";
import path from "path";
import { getMonthUsage, logUsage } from "../db/queries.js";
import { splitNarrationIntoChunks } from "../utils/captionChunks.js";

// 기본 v1 클라이언트에는 enableTimePointing/timepoints 필드가 없다 — 공식 문서 + 실제 설치 버전
// (package-lock.json 기준 5.8.1) GitHub 소스로 확인됨. SSML mark 타임포인팅은 v1beta1에서만 지원.
const client = new textToSpeech.v1beta1.TextToSpeechClient();
const MONTHLY_LIMIT = Number(process.env.TTS_MONTHLY_CHAR_LIMIT || 1000000);

export function getTtsQuotaStatus() {
  return { used: getMonthUsage("tts_chars"), limit: MONTHLY_LIMIT };
}

/**
 * 자막 청크들을 SSML로 결합하면서 청크 경계(1번째 청크부터)마다 <mark name="m{i}"/>를 삽입.
 * 청크 0은 화면에 바로 노출되므로 마크가 필요 없다(항상 startSec=0). 마지막 청크 앞에는
 * 기존 "마지막 문장 앞 pause" 연출을 "마지막 청크 앞 pause"로 근사 대체해 약간의 정적을 둔다.
 */
function buildSSMLWithMarks(chunks, { pauseBeforeLastMs = 400 } = {}) {
  if (chunks.length === 0) return { ssml: "<speak></speak>", markNames: [] };

  const markNames = [];
  const parts = chunks.map((chunk, i) => {
    const flatText = chunk.replace(/\n/g, " ");
    if (i === 0) return flatText;

    const markName = `m${i}`;
    markNames.push(markName);
    const isLast = i === chunks.length - 1;
    const pause = isLast && pauseBeforeLastMs ? `<break time="${pauseBeforeLastMs}ms"/>` : "";
    return `${pause}<mark name="${markName}"/>${flatText}`;
  });

  return { ssml: `<speak>${parts.join(" ")}</speak>`, markNames };
}

/** 글자수 비례 폴백 — timepoints가 기대한 개수만큼 오지 않았을 때 0~1 비율로 근사 반환 */
function fallbackRatioChunks(chunks) {
  const flatLengths = chunks.map((c) => c.replace(/\n/g, " ").length);
  const totalLen = flatLengths.reduce((sum, len) => sum + len, 0);

  let cumulative = 0;
  return chunks.map((chunk, i) => {
    const ratio = totalLen > 0 ? cumulative / totalLen : 0;
    cumulative += flatLengths[i];
    return { text: chunk, startSec: ratio, isRatio: true };
  });
}

/** timepoints 응답으로부터 청크별 시작 시각(초)을 계산. 개수가 안 맞으면 비율 폴백. */
function buildCaptionChunks(chunks, markNames, rawTimepoints) {
  const timepoints = rawTimepoints || [];

  if (timepoints.length !== markNames.length) {
    console.warn(
      `[tts] timepoints 개수가 예상과 다릅니다 (expected ${markNames.length}, got ${timepoints.length}). 글자수 비례 폴백을 사용합니다.`
    );
    return fallbackRatioChunks(chunks);
  }

  const timeByMark = new Map();
  timepoints.forEach((tp) => {
    const markName = tp.markName ?? tp.mark_name;
    const timeSeconds = tp.timeSeconds ?? tp.time_seconds;
    timeByMark.set(markName, Number(timeSeconds));
  });

  return chunks.map((chunk, i) => {
    if (i === 0) return { text: chunk, startSec: 0 };
    const startSec = timeByMark.get(markNames[i - 1]);
    if (startSec === undefined || Number.isNaN(startSec)) {
      console.warn(`[tts] mark ${markNames[i - 1]}의 timeSeconds를 찾을 수 없습니다. 글자수 비례 폴백을 사용합니다.`);
      return fallbackRatioChunks(chunks);
    }
    return { text: chunk, startSec };
  });
}

/**
 * 나레이션을 음성으로 합성. 나레이션을 2줄 자막 청크로 분할해 SSML mark로 청크별 시작 시각을
 * 함께 반환한다 — 한 이미지가 떠 있는 동안 자막만 2줄씩 갈아끼우는 연출에 사용.
 * voiceName: 기본은 채널 확정 보이스(ko-KR-Chirp3-HD-Charon). test-voices.js/화자별 보이스
 * 설정에서는 다른 값을 넘긴다.
 */
export async function synthesizeNarration(text, outputPath, voiceName = "ko-KR-Wavenet-D") {
  const charCount = text.length;
  const used = getMonthUsage("tts_chars");
  if (used + charCount > MONTHLY_LIMIT) {
    throw new Error("TTS 월간 무료 쿼터 초과 예상. 이번 달은 사용을 자제하세요.");
  }

  const chunks = splitNarrationIntoChunks(text);
  const { ssml, markNames } = buildSSMLWithMarks(chunks);

  const [response] = await client.synthesizeSpeech({
    input: { ssml },
    // 남성 보이스, Wavenet 등급. 원래는 더 자연스러운 Chirp3-HD-Charon을 썼으나, Chirp/Journey 계열은
    // SSML 자체를 지원하지 않아(공식 문서 확인: https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd,
    // https://discuss.google.dev/t/chirp3-hd-voices-dont-support-markup-field-in-long-audio-synthesis/185977)
    // <mark> 타임포인팅이 항상 빈 배열로 돌아와 자막 청크 전환이 실제 발화와 어긋나는 문제가 실제로
    // 재현됐다(2026-07-17). SSML mark를 지원하는 Wavenet-D로 교체 — characterB 기본값(Neural2-C)과
    // 겹치지 않도록 등급을 다르게 선택. 정확한 음색 비교는 실제로 들어봐야 확인 가능.
    voice: { languageCode: "ko-KR", name: voiceName },
    audioConfig: { audioEncoding: "MP3", speakingRate: 1.15 },
    enableTimePointing: ["SSML_MARK"],
  });

  // 실제 실행 시 응답 구조(camelCase/snake_case 여부 등)를 확인하기 위한 원본 로그 — 미검증 필드라
  // 방어적으로 처리 중.
  console.log("[tts] synthesizeSpeech timepoints raw:", JSON.stringify(response.timepoints));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, response.audioContent, "binary");

  logUsage("tts_chars", charCount);

  const captionChunks = buildCaptionChunks(chunks, markNames, response.timepoints);

  return { outputPath, captionChunks };
}
