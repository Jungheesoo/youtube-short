import Anthropic from "@anthropic-ai/sdk";
import { getRecentCategories, getAllPastTopics } from "../db/queries.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6"; // 필요시 opus로 교체 가능

/**
 * 대본을 구조화된 JSON으로 생성.
 * scenes: [{ narration, imagePrompt, durationSec }]
 * 이미지 프롬프트까지 여기서 같이 만들어서 스타일 일관성을 확보한다.
 */
export async function generateScript(topic, { styleGuide } = {}) {
  const system = `너는 유튜브 쇼츠 "만약에" 시리즈 전문 작가야.
반드시 아래 JSON 형식으로만 응답해. 다른 텍스트, 설명, 마크다운 코드블록 없이 순수 JSON만 출력해.

{
  "titleCandidates": ["제목1", "제목2", "제목3"],
  "description": "유튜브 설명란에 들어갈 텍스트",
  "scenes": [
    { "narration": "나레이션 텍스트", "imagePrompt": "나노바나나용 영어 이미지 프롬프트", "durationSec": 4, "sceneType": "content" }
  ]
}

규칙:
- description은 2~3문장으로 영상 내용을 요약하고 궁금증을 유발한 뒤, 마지막 줄에 관련 해시태그 4~5개(#역사쇼츠 #만약에시리즈 등, 주제에 맞게)를 추가
- 본편(content) 씬은 6~9개, 전체 40~55초 분량. 그 뒤에 아웃트로(outro) 씬을 정확히 1개 추가해서 scenes 배열 맨 마지막에 넣어 (총 7~10개 씬).
- imagePrompt는 모든 씬에서 동일한 아트 스타일 키워드를 포함해 일관성 유지 (예: "${
    styleGuide || "traditional Korean folk painting style, vibrant colors, digital illustration"
  }")
- imagePrompt 맨 끝에는 항상 세로 화면 비율 지시를 포함: "vertical 9:16 portrait orientation, mobile phone screen aspect ratio" (가로형으로 생성되면 나중에 세로로 크롭할 때 구도가 깨지므로 반드시 포함)
- 실존 인물 실명/딥페이크 묘사 금지, 대신 '한 무리의 사람들', '한 청년' 등으로 표현
- 선정적 표현은 과하지 않게, 유머러스한 반전 위주로
- 본편 마지막 씬(아웃트로 직전)은 임팩트 있는 마무리/반전으로 구성
- sceneType 필드는 반드시 명시: 본편은 "content", 마지막 1개는 "outro"

첫 번째 씬(scenes[0]) imagePrompt 규칙 (시각적 훅, 매우 중요):
- 시대착오적 오브젝트(예: 조선시대 인물 + 스마트폰처럼 시대와 어긋나는 물건)가 프레임 중심에 오도록 지시
- 인물의 표정(놀람/신남/당황 등)과 동작(그 오브젝트를 만지려거나 반응하려는 찰나)이 명확히 드러나도록 지시
- 정지된 정물 구도가 아니라 "지금 막 사건이 벌어지는 중"처럼 보이는 동적인 순간을 묘사할 것

마지막 씬(outro) 작성 규칙:
- narration: 자연스러운 구독 유도 문구 + 다음 편 예고를 포함. 다음 편 소재는 아직 정해지지 않았으니 구체적인 시대/소재를 언급하지 말고, 궁금증을 유발하는 톤으로만 예고할 것 (예: "다음엔 또 어떤 시대가 뒤집힐지 구독하고 기다려주세요" 같은 식으로, 매번 다른 표현 사용)
- imagePrompt: 본편과 동일한 아트 스타일을 유지하되, 구독 버튼이나 화살표 등 시각적 유도 요소를 암시하는 구도로 지시
- durationSec은 2~3초 정도로 짧게`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: `주제: "${topic}"` }],
  });

  const text = msg.content.find((b) => b.type === "text")?.text ?? "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
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
