import Anthropic from "@anthropic-ai/sdk";
import { getRecentCategories, getAllPastTopics } from "../db/queries.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6"; // 필요시 opus로 교체 가능

// "마음온도" 채널의 고정 화풍 — 모든 영상, 모든 씬에 항상 동일하게 적용된다.
// 주제(시대/장르)에 따라 화풍 자체를 바꾸는 로직은 두지 않음 — 매번 이 문구 하나만 사용.
export const STORYBOOK_STYLE = `soft watercolor and colored-pencil illustration, hand-painted texture with visible brushstrokes, warm pastel color palette, gentle diffused natural lighting, detailed painterly background elements, whimsical storybook atmosphere, nostalgic countryside mood, 2D hand-drawn animation cel style`;

// 인물 구도 고정 지시 — 인물이 항상 화면에 크게 나오도록.
export const COMPOSITION_RULE = `The subject must be shot as a medium shot / close-up, filling roughly half to two-thirds of the frame from waist-up, with a clearly visible face and posture. The background should be softly blurred, with the subject in sharp focus. Avoid wide landscape shots where the person appears small in the frame.`;

// 대화(캐릭터) 씬 전용 인물 구도 고정 지시 — 두 인물이 함께 등장하는 자연스러운 미디엄샷.
export const COMPOSITION_RULE_DIALOGUE = `Two people shot in a natural medium-shot composition, both upper bodies clearly visible and interacting naturally within the frame. Both subjects' necks connect naturally and continuously to their shoulders, no floating heads. Both hands of each person clearly visible, five fingers each, no overlapping or merged limbs. The background should be softly blurred with both subjects in sharp focus.`;

// 씬 상황(시간대)에 맞는 색감 — Claude는 이 중 하나의 키(timeOfDay)만 고르고,
// 실제 색감 문구는 백엔드가 붙인다 (출력 토큰 절약 + 색감 문구 일관성 확보).
export const TIME_OF_DAY_PALETTE = {
  dawn: "soft blue-violet dawn light, faint pink horizon, cool muted tones",
  day: "bright warm sunlight, clear soft blue sky, vivid but gentle colors",
  sunset: "warm golden hour lighting, soft orange-pink sky, long soft shadows",
  night: "deep indigo night sky, warm interior lamp glow, soft moonlight",
  overcast: "overcast soft diffused light, muted cool grays and blues, gentle misty atmosphere",
};

// 장소 다양화 지시 — 매번 집/실내로만 흐르지 않도록.
export const LOCATION_VARIETY_RULE = `Vary the location/setting across different videos (e.g., café, public transit, park, office, home, street, library) rather than defaulting to home/indoor scenes every time. Choose a location that fits the narration's emotional context.`;

// SNS 비교 장면에서 실제 앱 UI/로고를 재현하지 않도록 하는 지시.
export const COMPARISON_VISUAL_RULE = `When a scene involves a person looking at their phone and feeling compared to others (e.g., social media scrolling), the phone screen should show soft, blurred, unreadable colorful shapes suggesting vibrant photos or smiling faces — implying social media content without rendering any real app UI, logos, text, or readable content.`;

// 나레이션 구조 지시 — 2인칭 도입 + 3막 감정 구조.
export const NARRATION_STRUCTURE_RULE = `The narration must open in second person (addressing the viewer directly) to maximize immediate emotional relatability. The overall scene structure must follow a 3-act emotional arc: (1) relatable struggle/discomfort, (2) a quiet turning point or realization, (3) a hopeful, resonant resolution — avoid resolving the emotion too early in the sequence.`;

// 세로 화면 비율 고정 지시 (모든 imagePrompt 끝에 공통 삽입)
export const VERTICAL_SUFFIX = `vertical 9:16 portrait orientation, mobile phone screen aspect ratio`;

/**
 * 비용 최적화: 아래 고정 상수들은 매 씬마다 Claude가 "출력"하지 않고 (출력 토큰 비용 절감),
 * Claude 응답을 받은 뒤 이 함수에서 문자열 결합으로 완성한다.
 * Claude는 장면 묘사(sceneDescription)와 씬별 timeOfDay 키만 생성.
 * 최종 구조: [장면 묘사] + [COMPOSITION_RULE] + [해당 timeOfDay 색감] + [STORYBOOK_STYLE] + [VERTICAL_SUFFIX]
 */
function buildImagePrompt(sceneDescription, timeOfDay, speaker) {
  const palette = TIME_OF_DAY_PALETTE[timeOfDay] || TIME_OF_DAY_PALETTE.day;
  const composition = speaker && speaker !== "narrator" ? COMPOSITION_RULE_DIALOGUE : COMPOSITION_RULE;
  return [sceneDescription, composition, palette, STORYBOOK_STYLE, VERTICAL_SUFFIX].filter(Boolean).join(", ");
}

/**
 * 대본을 구조화된 JSON으로 생성.
 * scenes: [{ narration, imagePrompt, durationSec }]
 * 이미지 프롬프트까지 여기서 같이 만들어서 스타일 일관성을 확보한다.
 */
export async function generateScript(topic) {
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
  "scenes": [
    { "narration": "나레이션 텍스트", "sceneDescription": "장면 묘사만 담은 영어 문장(스타일/화질/카메라/비율 문구 없이)", "timeOfDay": "day", "durationSec": 4, "sceneType": "content", "speaker": "narrator" }
  ]
}

규칙:
- title은 "'걱정'만 할수록 수명만 깎인다" 같은 역설적/통찰적 한 줄 형태, 또는 "자존감 높은 사람들의 작은 습관"
  "마음이 따뜻한 사람과 그렇지 않은 사람의 차이"처럼 비교·습관형 한 줄 형태 중 주제에 맞는 쪽으로, 15자 내외로 짧고 강하게.
  비교·습관형이어도 재테크/성공 지향적 자극이 아니라 자존감·마음온도를 높이는 방향으로 귀결되게 할 것
- description은 2~3문장으로 영상 내용을 요약하고 공감을 유발한 뒤, 마지막 줄에 관련 해시태그 4~5개(#인생조언 #좋은글 #명언 등, 주제에 맞게)를 추가
- titleCandidates의 각 항목은 { "title", "hashtags" } 객체. hashtags는 항상 정확히 3개, 유튜브/인스타 등 플랫폼 구분 없이 동일하게 사용:
  1) "#마음온도" (채널 고정, 항상 포함)
  2) "#에세이" (채널 고정, 항상 포함)
  3) 대본 내용에 맞는 감정 태그 1개를 매번 다르게 생성 (예: "#위로가필요할때", "#공감백배", "#오늘의한마디" 등)
  title 자체에는 해시태그를 넣지 말고, hashtags 배열에만 담아
- 본편(content) 씬은 6~9개, 전체 40~55초 분량. 그 뒤에 아웃트로(outro) 씬을 정확히 1개 추가해서 scenes 배열 맨 마지막에 넣어 (총 7~10개 씬).
- 화풍(일러스트 렌더링 방식)은 모든 씬에 고정이라 백엔드가 자동으로 붙이니 sceneDescription에 언급하지 마. 대신 timeOfDay 필드에 그 씬 상황에 맞는 시간대를 아래 5개 키 중 하나로 정확히 골라: "dawn"(새벽), "day"(낮), "sunset"(노을), "night"(밤), "overcast"(흐린 날). 색감 문구는 백엔드가 이 키에 맞춰 자동 삽입하니 sceneDescription에 색감/조명 문구를 직접 쓰지 마.
- 장소 다양화: ${LOCATION_VARIETY_RULE}
- sceneDescription은 반드시 그 씬의 narration이 실제로 말하는 내용을 시각적으로 옮겨야 함(narration과 무관하게 일반적이거나 추상적인 장면을 넣지 마). narration이 특정 인물/행동을 이야기하면 그 인물/행동을 그리고, 특정 장소·사물·개념을 이야기하면 그 배경·사물을 그려서 — 나레이션을 들으며 봤을 때 "지금 이 얘기를 하고 있구나"가 바로 느껴지게 구성할 것. 인물의 표정/동작/구도, 배경 소품 등 "장면 내용"만 영어로 작성해. 렌더링 방식(일러스트풍 등), 구도, 화질/카메라 관련 문구, 화면 비율 지시는 절대 포함하지 마 — 이건 백엔드 코드가 자동으로 이어붙인다.
- 인물이 휴대폰으로 SNS를 보며 남과 비교하는 장면: ${COMPARISON_VISUAL_RULE}
- 실존 인물 실명/딥페이크 묘사 금지, 대신 '한 여성', '한 남성', '한 노부부', '한 청년' 등 익명 표현으로 묘사. 이 채널은 다양한 나이·성별의 인물이 등장하는 공감형 에세이이므로, 이야기 내용에 맞는 인물을 자유롭게 설정해(주인공 성별을 고정하지 않음)
- sceneDescription(영어)에 인물이 등장하면 반드시 한국인으로 명시해서 묘사할 것 (예: "a Korean woman", "a Korean man", "an elderly Korean couple", "a Korean office worker" 등 — "a woman", "a man"처럼 인종 묘사 없이 쓰지 말 것). 인물이 없는 씬(사물/풍경만)에는 이 표현을 넣지 마
- 나레이션이 "친구", "부모님", "그 사람"처럼 구체적인 인물/관계를 직접 언급하는 씬은 그 인물이 sceneDescription에 반드시 등장해야 함(빈 책상/사물만 보여주는 상징적 연출은 그 씬의 나레이션이 인물을 직접 언급하지 않을 때만 사용). 나레이션이 순수하게 개념/통계/장소만 이야기하는 씬만 인물 없이 사물/풍경으로 구성해도 됨
- 옷차림/소품은 그 씬의 상황(시간대, 장소, 방금 하던 행동)에 논리적으로 맞아야 함. "casual home wear", "comfortable clothes" 같은 모호한 표현은 이미지 생성 AI가 아무렇게나 해석해버리므로 절대 쓰지 말고, 반드시 구체적인 옷 종류를 명시할 것
- 선정적 표현이나 신체 노출/강조 구도는 금지 — 이 채널은 잔잔하고 담백한 톤이 핵심. 광고주 친화성(YPP 심사 통과, 노란 딱지 리스크)을 항상 고려
- 나레이션 구조: ${NARRATION_STRUCTURE_RULE} (2인칭 도입은 첫 씬 narration에 적용, 3막 구조는 전체 본편 씬에 걸쳐 적용)
- 모든 narration 문장은 "~요", "~습니다/입니다", "~하시나요?" 같은 존댓말/구어체 종결어미를 쓰지 말고,
  "~다", "~였다", "~한다", "~없다" 같은 서술체(다큐멘터리 내레이터 톤)로 끝낼 것.
  예: "초라해진 적 있으신가요?" (X) → "초라해진 적이 있다" (O), "괜찮습니다" (X) → "괜찮다" (O)
- 본편 마지막 씬(아웃트로 직전)은 감정적으로 가장 깊은 여운을 주는 장면으로 구성
- sceneType 필드는 반드시 명시: 본편은 "content", 마지막 1개는 "outro"
- 대화는 기본이 아니라 예외다. 주제가 순수하게 나레이터의 통찰/서술만으로 완결되는 경우가 대부분이며 이 경우 모든 씬의 speaker는 항상 "narrator"다. 대화는 오직 그 소재 자체가 누군가의 실제 말 한마디를 직접 인용해야 의미가 사는 경우(예: 부모님이 해준 말, 친구의 위로, 낯선 이의 한마디가 통찰의 핵심 소재인 주제)에만 예외적으로 사용하고, 이 경우에도 전체 씬 중 1~2개 씬에만 적용한다. 지금 추천되는 4개 카테고리(EMOTION_CATEGORIES) 전부에서 대화가 필요한 것도 아니니, 주제 성격에 맞지 않으면 절대 억지로 대화를 끼워 넣지 마라.
- 각 씬 JSON에는 speaker 필드를 반드시 포함해: 기본값은 "narrator"이고, 위 예외에 해당하는 씬만 "characterA" / "characterB" 등으로 표시
- 대화가 등장하는 씬은 한 씬에 여러 대사를 몰아넣지 말고, 화자별로 씬을 분리해서 생성할 것(예: characterA의 대사 1씬 + characterB의 반응 1씬)
- 캐릭터(비-narrator) 씬의 narration은 위의 서술체(~다, ~였다) 규칙 대신, 실제 구어체 대사로 10~15자 내외로 짧게 쓸 것(예: "괜찮아, 네 잘못 아니야"). 단 이 예외는 대화 씬에만 적용되고, narrator 씬의 서술체 종결어미 규칙은 그대로 유지
- 대화 씬의 sceneDescription은 그 화자가 말하거나 반응하는 모습(표정, 시선, 손짓)을 포함하고, 대화 상대가 함께 프레임에 있는 2인 구도로 구성할 것. 인물 묘사 시 위 규칙대로 한국인으로 명시하고(예: "a Korean woman gently speaking to a Korean man"), 목-어깨 연결과 손이 명확히 보이도록 안전장치 문구를 포함할 것(anatomically correct, no floating head, five fingers each, no overlapping limbs) — 두 인물 모두에 적용
- 대화 예외의 두 인물(characterA/characterB)은 외형(헤어스타일, 옷차림 색깔·종류, 대략적 나이대)을 구체적으로 정해서, 그 대화가 걸친 모든 씬(예: characterA의 대사 씬 + characterB의 반응 씬)의 sceneDescription에 매번 동일한 표현으로 반복 명시할 것(예: 한 씬에서 "a Korean woman in a beige cardigan with short bob hair"라고 썼다면, 같은 대화의 다른 씬에서도 이 인물은 항상 이 표현 그대로 등장). 이미지가 씬별로 따로 생성되기 때문에 외형 묘사가 씬마다 다르면 같은 대화인데 다른 사람처럼 보이는 문제가 생긴다. 단, 이 규칙은 하나의 대화 안에서만 적용되고, 그 대화와 무관한 다른 본편 씬(예: 비교·몽타주형 소재에서 씬마다 의도적으로 다른 인물이 등장하는 경우)에는 적용하지 마라 — 그런 씬들끼리는 인물이 서로 달라도 된다

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
    speaker: s.speaker || "narrator",
    imagePrompt: buildImagePrompt(s.sceneDescription, s.timeOfDay, s.speaker),
  }));

  return script;
}

// "마음온도" 채널의 감정 카테고리 로테이션 — 특정 소재가 아니라 에세이가 주는 감정적 효용 기준.
// recommendTopics는 최근 14일간 덜 다뤄진 카테고리를 우선 추천하도록 이 목록을 참고한다.
export const EMOTION_CATEGORIES = [
  "마음의 온도가 올라가는 이야기",
  "자존감을 찾아가는 이야기",
  "주변 사람을 돌보는 이야기",
  "성장과 통찰을 주는 이야기",
];

/**
 * 최근 제작 이력을 바탕으로 오늘의 추천 주제 3개 생성.
 * 예: 최근 다룬 감정 카테고리와 겹치지 않는 새로운 인생 지혜 소재 우선 추천
 */
export async function recommendTopics() {
  const recentCategories = getRecentCategories(14);
  const pastTopics = getAllPastTopics(20);

  const msg = await client.messages.create({
    model: MODEL,
    // 카테고리 로테이션 지시 + reason 문구가 길어져 기존 500으로는 응답이 잘릴 수 있어 상향.
    max_tokens: 1024,
    system: `너는 "마음온도" 채널(인생 지혜·공감 에세이 유튜브 쇼츠)의 기획자야. 최근 제작 이력을 참고해서
겹치지 않는 새로운 주제 3개를 추천해.

이 채널의 감정 카테고리는 정확히 아래 4개뿐이야. 매 추천마다 category 필드는 반드시 이 중 하나를 그대로 사용해:
${EMOTION_CATEGORIES.map((c) => `- "${c}"`).join("\n")}

최근 14일 카테고리 사용 현황(아래 user 메시지의 집계)을 보고, 사용 빈도가 낮거나 아예 없는 카테고리를 우선
추천해서 4개 카테고리가 골고루 로테이션되도록 해. 다만 카테고리 균형만 맞추려고 억지로 주제를 짜내지 말고,
그 카테고리에 자연스럽게 맞는 공감형 소재를 골라.

소재 유형: 순수 서사형("어떤 하루가 있었다") 소재뿐 아니라, "~하는 사람과 ~하지 않는 사람의 차이",
"자존감이 높은 사람들의 작은 습관", "마음이 따뜻한 사람들의 공통점" 같은 비교·습관형 소재도 적극 섞어서 추천해.
단, 이 채널은 재테크/자기계발 서적 판매 채널이 아니므로 "부자 되는 법", "성공하는 법" 같은 물질적 성공·자극적
후킹은 쓰지 말고, 항상 자존감을 높여주거나 마음의 온도를 실제로 높여주는(따뜻해지는) 방향으로 귀결되게 해.

반드시 아래 JSON 배열 형식으로만 응답해. 다른 텍스트, 설명, 마크다운 코드블록 없이 순수 JSON만 출력해:
[{ "topic": "...", "category": "...", "reason": "왜 지금 이 카테고리/주제를 추천하는지 한 줄(최근 사용 빈도 언급 포함)" }]`,
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
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // stop_reason이 "max_tokens"면 응답이 잘려서 JSON이 깨진 것 — 원본 텍스트를 에러 메시지에
    // 남겨서 error.log에서 바로 원인을 확인할 수 있게 한다 (Anthropic Messages API의 stop_reason
    // 필드는 공식 문서로 확인된 값: end_turn/max_tokens/stop_sequence/tool_use).
    throw new Error(
      `recommendTopics JSON 파싱 실패 (stop_reason: ${msg.stop_reason}): ${e.message}\n원본 응답: ${cleaned.slice(0, 1500)}`
    );
  }
}
