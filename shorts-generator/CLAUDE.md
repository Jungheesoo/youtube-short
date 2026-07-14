# CLAUDE.md — 마음온도 숏츠 자동 제작기

이 파일은 세션 시작 시 자동으로 읽힌다. 여기 있는 정보는 다시 파일을 뒤져서 확인하지 말고 그대로 신뢰할 것 — 단, "확정 정보 아님"이라고 명시된 항목은 예외.

## 목표
로컬 전용 웹앱. 하루 1~2개 유튜브 쇼츠 제작. 비용 0원. 완전 자동화 금지(최소 큐레이션 필수 — YouTube 양산형 쇼츠 수익 제한 정책 회피 목적).

**채널/콘텐츠 전환 이력**: 원래 "상상채굴단" 채널의 "만약에" 시리즈(역사+상상력 반전 스토리, 사실적 사진 스타일)로 시작했으나,
2026-07-14 세션에서 **"마음온도" 채널(인생 지혜·공감 에세이, 반사실적 웹툰/그래픽노블 일러스트 스타일)로 완전히 전환**했다.
`claude.js`/일부 프론트 텍스트는 이 전환을 반영해 전면 재작성됨. "만약에" 시리즈 관련 과거 코드/문서는 더 이상 유효하지 않음 — 아래 내용은 모두 "마음온도" 기준으로 갱신됨.

## 기술 스택
- 프론트: React + Vite, react-router-dom. 스타일은 순수 CSS(`frontend/src/index.css`) — Tailwind나 CSS-in-JS 추가하지 말 것.
- 백엔드: Node.js + Express, ESM(`"type": "module"`)
- DB: better-sqlite3, 파일 `backend/shorts.db`, 스키마는 `backend/src/db/init.js`
- 외부 API: Claude(대본/제목/설명/추천), Google Cloud TTS(나레이션), FFmpeg(합성)
- **이미지**: Gemini 이미지 생성 모델(나노바나나 계열)은 API로는 전부 유료(무료 티어 없음).
  대신 사람이 Google AI Studio 브라우저 화면에서 **Nano Banana 2 Lite**(`gemini-3.1-flash-lite-image`)로
  무료 생성 → 다운로드 → 앱에 업로드하는 수동 플로우로 동작. `gemini.js`에 API 자동 생성
  코드(`@google/genai`, interactions API)가 남아있지만 기본 플로우에서는 호출되지 않음 — 나중에
  결제하기로 하면 `ImagePage.jsx`의 업로드 버튼을 API 호출 버튼으로 되돌리면 재사용 가능.

## 디렉토리 구조
```
backend/src/routes/pipeline.js   — 전체 API 엔드포인트
backend/src/services/            — claude.js, gemini.js(미사용 API 코드), tts.js, ffmpeg.js
backend/src/db/                  — init.js(스키마), queries.js(이력/쿼터)
backend/src/jobs/pipelineState.js — 상태 머신 (draft→script_done→images_done→narration_done→rendered→uploaded)
backend/src/utils/logger.js      — 에러를 backend/logs/error.log에 기록 (콘솔 + 파일 동시)
frontend/src/pages/              — TopicPage, ImagePage, NarrationPage, RenderPage
frontend/src/api/client.js       — 백엔드 호출 래퍼, 새 엔드포인트 추가 시 여기도 갱신. toOutputUrl()로 파일 경로→URL 변환(윈도우 경로 대응)
```
새 기능 추가 시 이 구조를 따를 것. 폴더 새로 만들기 전에 기존 구조에 맞는 위치인지 먼저 확인.

## 절대 규칙 — 환각 방지
- `gemini.js`의 `NANOBANANA_MODEL`("gemini-2.5-flash-image"), `NANOBANANA_PRO_MODEL`("gemini-3-pro-image")은
  2026-07-13 기준 실제 문서로 검증된 값이지만, Google이 자주 갱신하므로 다시 쓰게 되면
  [Gemini API 모델 문서](https://ai.google.dev/gemini-api/docs/models)에서 재확인할 것. 단,
  이 API 경로는 현재 기본 플로우에서 미사용(위 "이미지" 항목 참고).
- Google Cloud TTS `enableTimePointing` 같은 SDK 세부 옵션이 불확실하면 실제 동작을 지어내지 말 것. 확인 안 된 API 필드/응답 구조는 코드 주석에 "미검증"이라고 명시하고, 가능하면 공식 문서를 검색해서 확인한 뒤에만 확정 구현.
- 모르는 것은 "모른다"고 답하고 다음 단계(문서 검색, 사용자 확인 요청)를 제안할 것. 그럴듯해 보이는 코드를 만들어 넣지 말 것.
- npm 패키지 버전을 package.json에 넣기 전 실제 존재하는 버전인지 확인.
- **FFmpeg + Windows 절대경로 조합에 주의**: `subtitles=` 필터처럼 인자를 자체 파싱하는 필터에
  드라이브 문자(`C:\...`)가 낀 절대경로를 넘기면 이스케이프를 해도 깨짐(실제 재현 확인됨). 해당
  파일이 있는 디렉터리를 `cwd`로 지정하고 파일명만 상대경로로 넘길 것 (`ffmpeg.js` 참고).

## 콘텐츠 정책 (프롬프트/대본 관련 코드 수정 시 반드시 준수)
- 실존 인물 딥페이크 금지 — 인물은 "한 여성", "한 남성", "한 노부부" 등 익명 표현만 사용. "마음온도"는 다양한 나이·성별의
  인물이 등장하는 공감형 에세이라, 주인공 성별을 특정 성별로 고정하지 않음(과거 "만약에" 시리즈의 "주인공 항상 여성" 규칙은 폐기됨).
- 완전 자동화 금지 — 이미지 재생성, 자막 확인 등 사람이 개입하는 큐레이션 스텝을 항상 유지.
- 선정적 표현/신체 노출·강조 구도 금지. 광고주 친화성(YPP 심사 통과, 노란 딱지 리스크)을 항상 고려해서 톤 조절. "마음온도"는
  잔잔하고 담백한 톤이 핵심이라 이 규칙을 특히 엄격히 지킬 것.
- 오프닝 씬은 title의 역설적/통찰적 한 줄을 시각적으로 뒷받침하는 상징적·감정적 장면으로 구성 (시각적 훅). 과거 "만약에"
  시리즈의 "시대착오적 오브젝트" 규칙은 이 채널에 맞지 않아 폐기됨.
- 렌더링 방식은 항상 "반사실적 웹툰/그래픽노블 일러스트 스타일"로 고정 — 사진처럼 보이면 안 됨(과거 "만약에" 시리즈는
  반대로 "항상 사실적 사진"이었으나 채널 전환으로 정반대가 됨). 장면마다 달라지는 건 색감 톤·시간대·배경 뿐이고, 이건
  Claude가 `styleGuide` 필드로 매번 새로 결정 (`claude.js` 참고). 일러스트 렌더링 방식 자체는 `ILLUSTRATION_STYLE`(같은 파일)
  고정 문구가 담당.

## 쿼터
- **이미지(AI Studio 수동)**: Nano Banana 2 Lite만 무료. Nano Banana 2(일반)/Pro는 AI Studio
  UI에서도 "Paid" 배지 붙어있어 유료. 무료 쿼터는 PT(태평양시간) 자정 기준 초기화되는 것으로
  보이나 정확한 일일 장수 한도는 미확인. `usage_log` 테이블의 nanobanana 관련 집계는 API
  자동 생성 경로가 살아있을 때를 위한 것이고 현재 수동 플로우에서는 갱신되지 않음.
- TTS(Google Cloud, DB `usage_log`로 월 단위 집계): 100만~400만자/월 (실제 한도는 자주 바뀌므로 코드 수정 전 Google 문서 재확인 권장)

## 작업 스타일
- 큰 변경(스키마 마이그레이션, 여러 파일에 걸친 리팩터링) 전에는 계획을 먼저 요약해서 보여주고 확인받을 것.
- 커밋 메시지는 한국어로 간결하게.
- 기존 파일을 통째로 재작성하지 말고, 필요한 부분만 최소 diff로 수정.
