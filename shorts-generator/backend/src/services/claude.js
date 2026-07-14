import Anthropic from "@anthropic-ai/sdk";
import { getRecentCategories, getAllPastTopics } from "../db/queries.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6"; // 필요시 opus로 교체 가능

// 나노바나나로 실사 테스트를 반복해 AI티가 줄어드는 걸 확인한 검증된 스타일 키워드 세트(원본).
// 나노바나나(Gemini 3.1 Flash Image)의 입력 토큰 한도(131,072)는 이 문구보다 훨씬 커서 API 자체
// 길이 제한에 걸릴 가능성은 낮음(ai.google.dev/gemini-api/docs/image-generation, 2026-07 확인) —
// 다만 실제 플로우는 API가 아니라 AI Studio 브라우저 UI에 수동으로 붙여넣는 방식이라, UI 입력창
// 자체의 제약은 미검증. 실사용 중 길이 문제가 생기면 문구 축약 필요.
//
// === 실사용 반복 조정 이력 ===
// v1(원본 "검증된" 세트): 카메라/피부질감 키워드 위주.
// v2: "not a cartoon..." 부정 문구 추가 — 원시부족 등 소재에서 코믹풍 렌더링 방지.
// v3: "natural asymmetric facial features..." 추가 — 얼굴이 너무 대칭적/정돈돼 보이는 문제 대응.
// v4: "natural blemishes" 추가했다가 여드름처럼 과하게 나와서 "no acne or blemishes"로 수정.
// v5(현재): v4까지도 여전히 피부가 거칠게 나옴 — 원인을 "ISO 1600 grain / 저조도 스냅샷 /
//   핸드헬드 흔들림" 등 거친 야간 촬영 느낌 문구로 재판단하고, 자연광+얕은 심도의 깔끔한
//   인물사진(라이프스타일 포토그래피) 톤으로 전면 교체함. 이 v5도 아직 반복 검증 안 됨 —
//   실사용 결과 보고 추가 조정 필요.
export const PHOTOREALISM_STYLE = `photorealistic photograph, absolutely not a cartoon, not an illustration, not anime, not a comic book, not a digital painting, not a 3D render, not stylized artwork — this must look like an actual professional-quality photograph of a real person, shot on a mirrorless camera with an 85mm f/1.8 portrait lens, soft natural daylight, shallow depth of field with a softly blurred background, sharp crisp focus on the face, minimal noise and grain, warm natural color grading (not oversaturated), no beauty retouching, no smoothing filter, lifestyle photography feel, natural asymmetric facial features like a real person (real human faces are never perfectly symmetric — one eye very slightly different from the other, nose very slightly off-center), clear healthy skin with natural fine pores and subtle sheen variation, not airbrushed or plastic-smooth, no acne or blemishes, slightly uneven natural teeth, genuine natural facial expression appropriate to the moment (not a stiff posed AI-generated look), extremely fine individual flyaway hair strands catching light naturally`;

// CG/판타지 오브젝트(구슬, 빛 이펙트 등 비현실적 요소)가 씬에 포함될 때 추가로 붙이는 보정 문구
export const CG_OBJECT_STYLE = `the object's surface should have subtle imperfections, slight blur at the edges, uneven glass-like reflections rather than perfectly clean geometry. Any connecting light/energy effects should look organic and slightly flickering, like smoke or a light leak, not a smooth digital line or CGI glow effect.`;

// 세로 화면 비율 고정 지시 (모든 imagePrompt 끝에 공통 삽입)
export const VERTICAL_SUFFIX = `vertical 9:16 portrait orientation, mobile phone screen aspect ratio`;

/**
 * 비용 최적화: PHOTOREALISM_STYLE/CG_OBJECT_STYLE/VERTICAL_SUFFIX는 매 씬마다 Claude가
 * "출력"하지 않고(출력 토큰 비용 절감), Claude 응답을 받은 뒤 이 함수에서 문자열 결합으로
 * 완성한다. Claude는 장면 묘사(sceneDescription)와 CG 오브젝트 여부(hasCgObject)만 생성.
 */
function buildImagePrompt(sceneDescription, styleGuide, hasCgObject) {
  const parts = [sceneDescription, styleGuide, PHOTOREALISM_STYLE];
  if (hasCgObject) parts.push(CG_OBJECT_STYLE);
  parts.push(VERTICAL_SUFFIX);
  return parts.filter(Boolean).join(", ");
}

/**
 * 대본을 구조화된 JSON으로 생성.
 * scenes: [{ narration, imagePrompt, durationSec }]
 * 이미지 프롬프트까지 여기서 같이 만들어서 스타일 일관성을 확보한다.
 */
export async function generateScript(topic, { styleGuide: forcedStyleGuide } = {}) {
  const styleInstruction = forcedStyleGuide
    ? `- styleGuide 필드에는 반드시 아래 스타일 문구를 그대로 사용해: "${forcedStyleGuide}"`
    : `- styleGuide 필드: 이 영상의 모든 이미지는 항상 "실제 카메라로 찍은 사실적인 사진"처럼 렌더링돼야 해 —
  일러스트, 웹툰, 동화책 삽화, 전통 채색화, 애니메이션, 만화(코믹), CGI/3D 렌더링 같은 그림 매체는 절대 안 됨.
  원시부족/전쟁터/판타지처럼 소재 자체가 만화적으로 느껴지는 장면일수록, styleGuide 문장 안에
  "not a cartoon, not a comic book, not an illustration" 같은 명시적 부정 표현을 꼭 넣어서 강조해.
  styleGuide에는 아트 매체를 고르지 말고, 주제의 시대/장르에 맞는 "배경·의상·소품·분위기"만 사실적 사진 묘사로
  담아서 영어로 직접 지어내(매번 주제에 맞게 새로 결정). 예시:
  - 조선/삼국시대 등 실제 역사 소재 → 그 시대 복식과 거리/건축이 살아있는 사실적 사진 배경 (예: "authentic Joseon-era hanbok and period-accurate street setting, shot like a real documentary photograph, not a cartoon, not a comic book, not a painting or illustration")
  - 미래/SF 소재 → 미래적 소품/배경이 있지만 사진처럼 촬영된 느낌 (예: "futuristic city street with realistic sci-fi props and lighting, captured like a real photograph, not a cartoon, not CGI-rendered or illustrated")
  - 신화/판타지/원시시대 소재 → 신비롭거나 원시적인 의상/소품이 있지만 실제 사람을 촬영한 것처럼 (예: "mystical fantasy costume and props, or primitive tribal attire, captured as if in a real photograph, absolutely not a cartoon, not a comic book, not painted or illustrated")
  - 현대/일상 뒤집기 소재 → 현대 도시 거리, 일상적인 옷차림의 사실적 사진 배경 (예: "contemporary city street, realistic everyday clothing, documentary photo style, not a cartoon or illustration")
  주제가 이 예시들에 정확히 안 맞으면 가장 가까운 설정으로 새로 지어내도 되지만, "사실적인 사진"이라는 렌더링 방식만은 절대 바꾸지 마.`;

  const system = `너는 유튜브 쇼츠 "만약에" 시리즈 전문 작가야.
반드시 아래 JSON 형식으로만 응답해. 다른 텍스트, 설명, 마크다운 코드블록 없이 순수 JSON만 출력해.

{
  "titleCandidates": [
    { "title": "제목1", "hashtags": ["#상상채굴단", "#만약에", "#소름주의"] },
    { "title": "제목2", "hashtags": ["#상상채굴단", "#만약에", "#반전결말"] },
    { "title": "제목3", "hashtags": ["#상상채굴단", "#만약에", "#호기심주의"] }
  ],
  "description": "유튜브 설명란에 들어갈 텍스트",
  "styleGuide": "이번 영상 전체에 쓸 아트 스타일 영어 문구",
  "scenes": [
    { "narration": "나레이션 텍스트", "sceneDescription": "장면 묘사만 담은 영어 문장(스타일/화질/카메라/비율 문구 없이)", "hasCgObject": false, "durationSec": 4, "sceneType": "content" }
  ]
}

규칙:
- description은 2~3문장으로 영상 내용을 요약하고 궁금증을 유발한 뒤, 마지막 줄에 관련 해시태그 4~5개(#역사쇼츠 #만약에시리즈 등, 주제에 맞게)를 추가
- titleCandidates의 각 항목은 { "title", "hashtags" } 객체. hashtags는 항상 정확히 3개, 유튜브/인스타 등 플랫폼 구분 없이 동일하게 사용:
  1) "#상상채굴단" (채널 고정, 항상 포함)
  2) "#만약에" (채널 고정, 항상 포함)
  3) 대본 내용에 맞는 감정/반응 태그 1개를 매번 다르게 생성 (예: "#소름주의", "#반전결말", "#호기심주의" 등)
  title 자체에는 해시태그를 넣지 말고, hashtags 배열에만 담아
- 본편(content) 씬은 6~9개, 전체 40~55초 분량. 그 뒤에 아웃트로(outro) 씬을 정확히 1개 추가해서 scenes 배열 맨 마지막에 넣어 (총 7~10개 씬).
${styleInstruction}
- sceneDescription에는 인물의 표정/동작/구도 등 "장면 내용"만 영어로 작성해. 스타일 톤(민화풍 등), 화질/카메라 관련 문구, 화면 비율 지시는 절대 포함하지 마 — 이건 백엔드 코드가 styleGuide와 함께 자동으로 이어붙인다.
- hasCgObject: 이 씬에 구슬, 빛 이펙트 등 CG/판타지성 비현실적 오브젝트가 등장하면 true, 아니면 false
- 실존 인물 실명/딥페이크 묘사 금지, 대신 '한 무리의 사람들', '한 젊은 여성' 등 익명 표현으로 묘사
- 주인공(중심 인물)은 스토리상 성별이 명확히 정해져야 하는 특별한 이유(예: 실제 역사 속 남성 인물 재현)가 없다면 항상 젊은 여성으로 설정 — 유튜브 쇼츠 시청자의 시선을 끌기 위함. 실존 인물이 아닌 가상의 인물이라는 전제 하에, sceneDescription 인물 묘사에 "a pretty/cute young Korean woman" 같은 표현을 자연스럽게 포함시켜서 얼굴이 매력적으로 나오도록 해. 원피스, 나시, 반바지 등 세련된 옷차림도 자연스럽게 포함시켜도 되지만, 노출은 금지이나, 신체 부위를 강조하는 구도는 살짝 나와도 무방함, 선정적 문구/암시는 금지(광고주 친화성 정책 위반, 노란 딱지 리스크 — 아래 규칙과 동일)
- 모든 씬에 인물이 나올 필요는 없음. 나레이션 내용상 사물/문서/장소/화면 텍스트 등만 보여줘도 충분한 씬(예: 통계 그래픽, 옷 매장 진열대, 신문 기사 클로즈업 등)은 억지로 인물을 등장시키지 말고 인물 없이 구성해도 됨. 위 여성 주인공 설정은 "인물이 등장하는 씬"에서만 적용되는 규칙임.
- 옷차림/소품은 그 씬의 상황(시간대, 장소, 방금 하던 행동)에 논리적으로 맞아야 함. "casual home wear", "comfortable clothes" 같은 모호한 표현은 이미지 생성 AI가 아무렇게나(예: 청바지) 해석해버리므로 절대 쓰지 말고, 반드시 구체적인 옷 종류를 명시할 것. 예: 방금 일어난 침실 장면 → "a loose sleep t-shirt and pajama shorts"처럼 구체적으로. 나레이션과 sceneDescription이 묘사하는 상황과 옷차림이 서로 모순되지 않도록 항상 점검할 것
- 선정적 표현은 과하지 않게, 유머러스한 반전 위주로
- 본편 마지막 씬(아웃트로 직전)은 임팩트 있는 마무리/반전으로 구성
- sceneType 필드는 반드시 명시: 본편은 "content", 마지막 1개는 "outro"

첫 번째 씬(scenes[0]) sceneDescription 규칙 (시각적 훅, 매우 중요):
- 시대착오적 오브젝트(예: 조선시대 인물 + 스마트폰처럼 시대와 어긋나는 물건)가 프레임 중심에 오도록 지시
- 인물의 표정(놀람/신남/당황 등)과 동작(그 오브젝트를 만지려거나 반응하려는 찰나)이 명확히 드러나도록 지시
- 정지된 정물 구도가 아니라 "지금 막 사건이 벌어지는 중"처럼 보이는 동적인 순간을 묘사할 것

마지막 씬(outro) 작성 규칙:
- narration: 자연스러운 구독 유도 문구 + 다음 편 예고를 포함. 다음 편 소재는 아직 정해지지 않았으니 구체적인 시대/소재를 언급하지 말고, 궁금증을 유발하는 톤으로만 예고할 것 (예: "다음엔 또 어떤 시대가 뒤집힐지 구독하고 기다려주세요" 같은 식으로, 매번 다른 표현 사용)
- sceneDescription: 구독 버튼이나 화살표 등 시각적 유도 요소를 암시하는 구도로 지시 (아트 스타일 톤은 다른 씬과 마찬가지로 백엔드가 자동 삽입하므로 여기 넣지 마). sceneDescription 자체는 영어로 쓰지만, 이미지 안에 버튼/텍스트가 보이는 구도를 지시할 땐 영어 "SUBSCRIBE"가 아니라 반드시 한글 "구독" 글자가 표시되도록 명시할 것(예: a button showing the Korean text "구독"). 채널명이 필요한 그래픽이 있다면 채널명 "상상채굴단"도 한글로 명시.
  인물 포즈는 "엄지척 + 손가락으로 버튼 가리키기"처럼 뻔하고 진부한 포즈를 반복하지 말고, 매번 아래 중에서 자연스럽게 골라 다르게 써:
  - 장난스럽게 윙크하며 입가에 손을 살짝 대고 비밀 얘기하듯 속삭이는 포즈
  - 카메라 쪽으로 몸을 기울이며 눈을 크게 뜨고 "이거 실화냐"는 표정으로 놀라는 포즈
  - 벤치나 계단에 편하게 앉아서 손바닥을 살짝 펴 보이며 여유롭게 미소짓는 포즈
  - 카메라를 향해 걸어오며 자연스럽게 웃음 짓고 손을 흔들거나 손짓으로 부르는 포즈
  - 두 손을 모아 부탁하듯 살짝 고개를 기울이며 순수하게 웃는 포즈
  - V자(브이) 사인을 하며 밝게 웃는 포즈
- durationSec은 2~3초 정도로 짧게`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: `주제: "${topic}"` }],
  });

  // 비용 최적화 효과 확인용 — PHOTOREALISM_STYLE을 백엔드 조립으로 옮기기 전/후
  // output_tokens 비교 목적. Anthropic Messages API 응답의 usage 필드(공식 문서 확인됨).
  console.log("[claude] generateScript usage:", msg.usage);

  const text = msg.content.find((b) => b.type === "text")?.text ?? "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();
  const script = JSON.parse(cleaned);

  script.scenes = (script.scenes || []).map((s) => ({
    ...s,
    imagePrompt: buildImagePrompt(s.sceneDescription, script.styleGuide, s.hasCgObject),
  }));

  return script;
}

/**
 * 최근 제작 이력을 바탕으로 오늘의 추천 주제 3개 생성.
 * 예: 어제 신라 -> 오늘 백제/가야 등 겹치지 않는 카테고리 우선 추천
 */
export async function recommendTopics() {
  const recentCategories = getRecentCategories(14);
  const pastTopics = getAllPastTopics(20);

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: `너는 "만약에" 시리즈 유튜브 숏츠 기획자야. 최근 제작 이력을 참고해서
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
