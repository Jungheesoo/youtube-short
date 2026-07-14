import Anthropic from "@anthropic-ai/sdk";
import { getRecentCategories, getAllPastTopics } from "../db/queries.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6"; // 필요시 opus로 교체 가능

// "마음온도" 채널의 고정 렌더링 방식 — 부드러운 수채화 톤의 일러스트풍(사실적 사진 아님).
// 특정 스튜디오/작가 이름은 상표·저작권 리스크로 프롬프트에 넣지 않고, 원하는 시각적 특징만
// 일반적인 화풍 묘사로 담았다. 아직 실사용 반복 검증 전 — 실제 나노바나나 결과 보고 조정 필요.
export const ILLUSTRATION_STYLE = `hand-painted watercolor storybook illustration style, soft visible watercolor texture and gentle color bleeding, warm natural sunlight, painterly nature backgrounds with lush greenery and soft clouds, gentle rounded character designs with simple expressive faces, semi-realistic but clearly hand-illustrated (not a photograph), soft muted warm color palette, delicate linework, not a flat vector cartoon, not anime, not a comic book, not 3D render, not a photorealistic photograph, nostalgic and heartwarming mood, consistent illustrated character rendering`;

// 세로 화면 비율 고정 지시 (모든 imagePrompt 끝에 공통 삽입)
export const VERTICAL_SUFFIX = `vertical 9:16 portrait orientation, mobile phone screen aspect ratio`;

/**
 * 비용 최적화: ILLUSTRATION_STYLE/VERTICAL_SUFFIX는 매 씬마다 Claude가 "출력"하지 않고
 * (출력 토큰 비용 절감), Claude 응답을 받은 뒤 이 함수에서 문자열 결합으로 완성한다.
 * Claude는 장면 묘사(sceneDescription)만 생성.
 */
function buildImagePrompt(sceneDescription, styleGuide) {
  return [sceneDescription, styleGuide, ILLUSTRATION_STYLE, VERTICAL_SUFFIX].filter(Boolean).join(", ");
}

/**
 * 대본을 구조화된 JSON으로 생성.
 * scenes: [{ narration, imagePrompt, durationSec }]
 * 이미지 프롬프트까지 여기서 같이 만들어서 스타일 일관성을 확보한다.
 */
export async function generateScript(topic, { styleGuide: forcedStyleGuide } = {}) {
  const styleInstruction = forcedStyleGuide
    ? `- styleGuide 필드에는 반드시 아래 스타일 문구를 그대로 사용해: "${forcedStyleGuide}"`
    : `- styleGuide 필드: 렌더링 매체(일러스트풍)는 고정이고 백엔드가 자동으로 붙이니 여기서 다시 언급하지 마.
  styleGuide에는 이번 주제/분위기에 맞는 "색감 톤·시간대·장소 배경"만 영어로 직접 지어내(매번 다르게).
  예: 위로가 필요한 이야기 → 따뜻한 노을빛 색감, 조용한 골목/카페 배경 (예: "warm golden-hour tones, quiet cozy cafe or alley setting")
      단호한 깨달음/통찰 이야기 → 차분한 새벽빛 색감, 정돈된 실내 배경 (예: "calm cool dawn tones, tidy minimal indoor setting")
  주제 분위기에 맞는 톤을 새로 지어내되, 한 영상 안에서는 이 톤을 일관되게 유지해.`;

  const system = `너는 유튜브 쇼츠 채널 "마음온도"의 전속 작가야. "마음온도"는 인생 지혜·공감 에세이 숏츠 채널로,
역설적이거나 곱씹게 되는 한 줄 통찰로 시작해서, 공감 가는 일상 이야기로 풀어가고, 여운 있는 마무리로 끝나는
포맷이야 (예: "'걱정'만 할수록 수명만 깎인다").

반드시 아래 JSON 형식으로만 응답해. 다른 텍스트, 설명, 마크다운 코드블록 없이 순수 JSON만 출력해.

{
  "titleCandidates": [
    { "title": "제목1", "hashtags": ["#마음온도", "#에세이", "#위로가필요할때"] },
    { "title": "제목2", "hashtags": ["#마음온도", "#에세이", "#공감백배"] },
    { "title": "제목3", "hashtags": ["#마음온도", "#에세이", "#오늘의한마디"] }
  ],
  "description": "유튜브 설명란에 들어갈 텍스트",
  "styleGuide": "이번 영상 전체에 쓸 색감/배경 톤 영어 문구",
  "scenes": [
    { "narration": "나레이션 텍스트", "sceneDescription": "장면 묘사만 담은 영어 문장(스타일/화질/카메라/비율 문구 없이)", "durationSec": 4, "sceneType": "content" }
  ]
}

규칙:
- title은 "'걱정'만 할수록 수명만 깎인다" 같은 역설적/통찰적 한 줄 형태로, 15자 내외로 짧고 강하게
- description은 2~3문장으로 영상 내용을 요약하고 공감을 유발한 뒤, 마지막 줄에 관련 해시태그 4~5개(#인생조언 #좋은글 #명언 등, 주제에 맞게)를 추가
- titleCandidates의 각 항목은 { "title", "hashtags" } 객체. hashtags는 항상 정확히 3개, 유튜브/인스타 등 플랫폼 구분 없이 동일하게 사용:
  1) "#마음온도" (채널 고정, 항상 포함)
  2) "#에세이" (채널 고정, 항상 포함)
  3) 대본 내용에 맞는 감정 태그 1개를 매번 다르게 생성 (예: "#위로가필요할때", "#공감백배", "#오늘의한마디" 등)
  title 자체에는 해시태그를 넣지 말고, hashtags 배열에만 담아
- 본편(content) 씬은 6~9개, 전체 40~55초 분량. 그 뒤에 아웃트로(outro) 씬을 정확히 1개 추가해서 scenes 배열 맨 마지막에 넣어 (총 7~10개 씬).
${styleInstruction}
- sceneDescription은 반드시 그 씬의 narration이 실제로 말하는 내용을 시각적으로 옮겨야 함(narration과 무관하게 일반적이거나 추상적인 장면을 넣지 마). narration이 특정 인물/행동을 이야기하면 그 인물/행동을 그리고, 특정 장소·사물·개념을 이야기하면 그 배경·사물을 그려서 — 나레이션을 들으며 봤을 때 "지금 이 얘기를 하고 있구나"가 바로 느껴지게 구성할 것. 인물의 표정/동작/구도, 배경 소품 등 "장면 내용"만 영어로 작성해. 렌더링 방식(일러스트풍 등), 화질/카메라 관련 문구, 화면 비율 지시는 절대 포함하지 마 — 이건 백엔드 코드가 styleGuide와 함께 자동으로 이어붙인다.
- 실존 인물 실명/딥페이크 묘사 금지, 대신 '한 여성', '한 남성', '한 노부부', '한 청년' 등 익명 표현으로 묘사. 이 채널은 다양한 나이·성별의 인물이 등장하는 공감형 에세이이므로, 이야기 내용에 맞는 인물을 자유롭게 설정해(주인공 성별을 고정하지 않음)
- 나레이션이 "친구", "부모님", "그 사람"처럼 구체적인 인물/관계를 직접 언급하는 씬은 그 인물이 sceneDescription에 반드시 등장해야 함(빈 책상/사물만 보여주는 상징적 연출은 그 씬의 나레이션이 인물을 직접 언급하지 않을 때만 사용). 나레이션이 순수하게 개념/통계/장소만 이야기하는 씬만 인물 없이 사물/풍경으로 구성해도 됨
- 옷차림/소품은 그 씬의 상황(시간대, 장소, 방금 하던 행동)에 논리적으로 맞아야 함. "casual home wear", "comfortable clothes" 같은 모호한 표현은 이미지 생성 AI가 아무렇게나 해석해버리므로 절대 쓰지 말고, 반드시 구체적인 옷 종류를 명시할 것
- 선정적 표현이나 신체 노출/강조 구도는 금지 — 이 채널은 잔잔하고 담백한 톤이 핵심. 광고주 친화성(YPP 심사 통과, 노란 딱지 리스크)을 항상 고려
- 모든 narration 문장은 "~요", "~습니다/입니다", "~하시나요?" 같은 존댓말/구어체 종결어미를 쓰지 말고,
  "~다", "~였다", "~한다", "~없다" 같은 서술체(다큐멘터리 내레이터 톤)로 끝낼 것.
  예: "초라해진 적 있으신가요?" (X) → "초라해진 적이 있다" (O), "괜찮습니다" (X) → "괜찮다" (O)
- 본편 마지막 씬(아웃트로 직전)은 감정적으로 가장 깊은 여운을 주는 장면으로 구성
- sceneType 필드는 반드시 명시: 본편은 "content", 마지막 1개는 "outro"

첫 번째 씬(scenes[0]) sceneDescription 규칙 (시각적 훅, 매우 중요):
- title의 역설적/통찰적 한 줄을 시각적으로 뒷받침하는 상징적이고 감정이 드러나는 장면으로 구성
  (예: "걱정만 할수록 수명만 깎인다" → 초조하게 시계를 보거나 뒤척이며 잠 못 이루는 인물)
- 인물의 표정과 동작에서 그 감정이 명확히 드러나도록 지시
- 정지된 정물 구도가 아니라 "감정이 막 드러나는 찰나"처럼 보이는 순간을 묘사할 것

마지막 씬(outro) 작성 규칙:
- narration: 오늘 이야기의 감정을 담백하게 여운으로 남기는 한마디로 마무리. "구독"이나 "다음 편" 같은 유도 문구는 절대 넣지 마 — 감동/여운이 깨지지 않도록, 이야기 자체로 조용히 끝나는 느낌이어야 함. 위 서술체(~다) 종결어미 규칙도 그대로 적용 (예: "때로는 그 한마디가, 하루를 버티게 한다" 같은 식으로, 매번 다른 표현 사용)
- sceneDescription: 구독 버튼, 화살표, "구독" 텍스트 등 어떤 유도 그래픽도 절대 넣지 마. 그냥 이야기의 여운이 남는 마지막 정서적 장면으로 구성 (렌더링 방식은 다른 씬과 마찬가지로 백엔드가 자동 삽입하므로 여기 넣지 마).
  인물 포즈는 이 채널의 잔잔한 톤에 맞게, 매번 아래 중에서 자연스럽게 골라 다르게 써:
  - 따뜻하게 미소 지으며 두 손을 살짝 모으는 포즈
  - 창밖을 보다가 고개를 돌려 잔잔하게 웃는 포즈
  - 카메라를 향해 고개를 살짝 끄덕이며 공감하듯 바라보는 포즈
  - 따뜻한 차 한 잔을 들고 편안하게 앉아있는 포즈
  - 노을을 등지고 걸어가다 조용히 뒤돌아보는 포즈
  - 두 손을 가슴 앞에 모으고 은은하게 웃는 포즈
- durationSec은 2~3초 정도로 짧게`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: `주제: "${topic}"` }],
  });

  // 비용 확인용 — Anthropic Messages API 응답의 usage 필드(공식 문서 확인됨).
  console.log("[claude] generateScript usage:", msg.usage);

  const text = msg.content.find((b) => b.type === "text")?.text ?? "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();
  const script = JSON.parse(cleaned);

  script.scenes = (script.scenes || []).map((s) => ({
    ...s,
    imagePrompt: buildImagePrompt(s.sceneDescription, script.styleGuide),
  }));

  return script;
}

/**
 * 최근 제작 이력을 바탕으로 오늘의 추천 주제 3개 생성.
 * 예: 최근 다룬 감정/소재와 겹치지 않는 새로운 인생 지혜 소재 우선 추천
 */
export async function recommendTopics() {
  const recentCategories = getRecentCategories(14);
  const pastTopics = getAllPastTopics(20);

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: `너는 "마음온도" 채널(인생 지혜·공감 에세이 유튜브 쇼츠)의 기획자야. 최근 제작 이력을 참고해서
겹치지 않는 새로운 주제 3개를 추천해. 반드시 아래 JSON 배열 형식으로만 응답해:
[{ "topic": "...", "category": "...", "reason": "왜 지금 추천하는지 한 줄" }]`,
    messages: [
      {
        role: "user",
        content: `최근 14일 카테고리 사용 현황: ${JSON.stringify(recentCategories)}
최근 제작한 주제 목록: ${JSON.stringify(pastTopics.map((t) => t.topic))}`,
      },
    ],
  });

  const text = msg.content.find((b) => b.type === "text")?.text ?? "[]";
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}
