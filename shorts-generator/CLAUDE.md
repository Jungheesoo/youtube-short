# CLAUDE.md — 만약에 시리즈 숏츠 자동 제작기

이 파일은 세션 시작 시 자동으로 읽힌다. 여기 있는 정보는 다시 파일을 뒤져서 확인하지 말고 그대로 신뢰할 것 — 단, "확정 정보 아님"이라고 명시된 항목은 예외.

## 목표
로컬 전용 웹앱. 하루 1~2개 유튜브 쇼츠("만약에" 시리즈: 역사+상상력) 제작. 비용 0원. 완전 자동화 금지(최소 큐레이션 필수 — YouTube 양산형 쇼츠 수익 제한 정책 회피 목적).

## 기술 스택
- 프론트: React + Vite, react-router-dom. 스타일은 순수 CSS(`frontend/src/index.css`) — Tailwind나 CSS-in-JS 추가하지 말 것.
- 백엔드: Node.js + Express, ESM(`"type": "module"`)
- DB: better-sqlite3, 파일 `backend/shorts.db`, 스키마는 `backend/src/db/init.js`
- 외부 API: Claude(대본/제목/추천), Gemini 나노바나나(이미지), Google Cloud TTS(나레이션), FFmpeg(합성)

## 디렉토리 구조
```
backend/src/routes/pipeline.js   — 전체 API 엔드포인트
backend/src/services/            — claude.js, gemini.js, tts.js, ffmpeg.js
backend/src/db/                  — init.js(스키마), queries.js(이력/쿼터)
backend/src/jobs/pipelineState.js — 상태 머신 (draft→script_done→images_done→narration_done→rendered→uploaded)
frontend/src/pages/              — TopicPage, ImagePage, NarrationPage, RenderPage
frontend/src/api/client.js       — 백엔드 호출 래퍼, 새 엔드포인트 추가 시 여기도 갱신
```
새 기능 추가 시 이 구조를 따를 것. 폴더 새로 만들기 전에 기존 구조에 맞는 위치인지 먼저 확인.

## 절대 규칙 — 환각 방지
- `gemini.js`의 `NANOBANANA_MODEL`, `NANOBANANA_PRO_MODEL` 값과 응답 파싱(`inlineData` 등)은 **확정 정보 아님** — 실제 Gemini API 문서를 확인하기 전까지는 추측 코드로 덮어쓰지 말고 `// TODO: 검증 필요` 주석 유지.
- Google Cloud TTS `enableTimePointing` 같은 SDK 세부 옵션이 불확실하면 실제 동작을 지어내지 말 것. 확인 안 된 API 필드/응답 구조는 코드 주석에 "미검증"이라고 명시하고, 가능하면 공식 문서를 검색해서 확인한 뒤에만 확정 구현.
- 모르는 것은 "모른다"고 답하고 다음 단계(문서 검색, 사용자 확인 요청)를 제안할 것. 그럴듯해 보이는 코드를 만들어 넣지 말 것.
- npm 패키지 버전을 package.json에 넣기 전 실제 존재하는 버전인지 확인.

## 콘텐츠 정책 (프롬프트/대본 관련 코드 수정 시 반드시 준수)
- 실존 인물 딥페이크 금지 — 인물은 "한 청년", "한 무리의 사람들" 등 익명 표현만 사용.
- 완전 자동화 금지 — 이미지 재생성, 자막 확인 등 사람이 개입하는 큐레이션 스텝을 항상 유지.
- 선정적 표현은 과하지 않게. 광고주 친화성(YPP 심사 통과, 노란 딱지 리스크)을 항상 고려해서 톤 조절.
- 오프닝 씬은 항상 "시대착오적 오브젝트 + 인물 표정/동작"이 프레임 중심에 오도록 프롬프트 구성 (시각적 훅).

## 쿼터 (DB `usage_log` 테이블로 일/월 단위 집계)
- 나노바나나: 100장/일, 나노바나나 프로: 2장/일 (실제 한도는 자주 바뀌므로 코드 수정 전 Google 문서 재확인 권장)
- TTS: 100만~400만자/월

## 작업 스타일
- 큰 변경(스키마 마이그레이션, 여러 파일에 걸친 리팩터링) 전에는 계획을 먼저 요약해서 보여주고 확인받을 것.
- 커밋 메시지는 한국어로 간결하게.
- 기존 파일을 통째로 재작성하지 말고, 필요한 부분만 최소 diff로 수정.
