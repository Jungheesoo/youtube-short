import path from "path";
import { synthesizeNarration } from "./src/services/tts.js";

// TTS 보이스 후보 비교용 스크립트. `node test-voices.js` 한 번 실행하면 아래 후보 전체를
// 동일한 테스트 문장으로 합성해서 backend/output/voice-test/에 저장한다.
// 보이스 하나를 최종 확정하면, 그다음엔 별도로 tts.js의 synthesizeNarration 기본값(voiceName)에
// 고정 반영 요청할 예정 — 지금은 비교용 후보만 나열.
const CANDIDATE_VOICES = ["ko-KR-Wavenet-D", "ko-KR-Neural2-C", "ko-KR-Wavenet-C"];

const TEST_SENTENCE =
  "걱정만 할수록 수명만 깎인다는 말이 있다. 오늘 하루도 애쓰며 살아낸 당신에게, 작은 위로를 건네고 싶다.";

const OUTPUT_DIR = path.join(process.cwd(), "output", "voice-test");

async function main() {
  for (const voiceName of CANDIDATE_VOICES) {
    const outputPath = path.join(OUTPUT_DIR, `voice-test-${voiceName}.mp3`);
    console.log(`[test-voices] 합성 중: ${voiceName}`);
    try {
      await synthesizeNarration(TEST_SENTENCE, outputPath, voiceName);
      console.log(`[test-voices] 저장됨: ${outputPath}`);
    } catch (e) {
      console.error(`[test-voices] 실패 (${voiceName}):`, e.message);
    }
  }
}

main();
