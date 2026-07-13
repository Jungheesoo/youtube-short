# 만약에 시리즈 — 유튜브 숏츠 자동 제작 웹앱

로컬 컴퓨터에서 실행하는 무료 숏츠 제작 파이프라인.
Claude(대본) → 나노바나나(이미지) → Google TTS(나레이션) → FFmpeg(합성)

## 1. 설치

```bash
# 백엔드
cd backend
npm install
cp .env.example .env   # 아래 API 키 채워넣기

# 프론트엔드
cd ../frontend
npm install
```

### FFmpeg 설치 (시스템 레벨, npm이 아님)
```bash
# macOS
brew install ffmpeg
# Ubuntu/Debian
sudo apt install ffmpeg
# Windows: https://ffmpeg.org/download.html 에서 다운로드 후 PATH 등록
```

## 2. API 키 준비

| 서비스 | 키 발급 위치 | .env 변수 |
|---|---|---|
| Claude | https://console.anthropic.com | `ANTHROPIC_API_KEY` |
| Gemini (나노바나나) | https://aistudio.google.com/apikey | `GEMINI_API_KEY` |
| Google Cloud TTS | GCP 콘솔 → 서비스 계정 JSON 다운로드 | `GOOGLE_APPLICATION_CREDENTIALS` (JSON 파일 경로) |

⚠️ **나노바나나 모델명 확인 필요**: `backend/src/services/gemini.js` 상단의
`NANOBANANA_MODEL` / `NANOBANANA_PRO_MODEL` 값은 Google이 자주 갱신하므로,
[Gemini API 모델 문서](https://ai.google.dev/gemini-api/docs/models)에서 최신 이미지 생성
모델명으로 교체하세요.

## 3. 실행

```bash
# 터미널 1
cd backend && npm run dev

# 터미널 2
cd frontend && npm run dev
```

브라우저에서 `http://localhost:5173` 접속.

## 4. 파이프라인 흐름

1. **주제 입력** — 직접 입력 또는 Claude 추천 주제 카드 선택 → 대본 자동 생성
   - 오프닝 씬(#1)은 항상 "시대착오적 오브젝트가 프레임 중심 + 인물 표정/동작이 드러나는, 사건이 벌어지는 중" 구도로 지시
   - 본편 씬 뒤에 구독 유도 + 다음 편 예고용 **아웃트로 씬**을 자동으로 1개 추가 (`sceneType: "outro"`)
2. **이미지 생성** — 컷별 카드에서 개별 재생성 가능, 나노바나나 쿼터 실시간 표시. 아웃트로 씬은 "아웃트로" 뱃지로 본편과 구분 표시
3. **나레이션** — 씬별 TTS 생성, SSML로 자연스러운 pause 적용
4. **합성/미리보기** — Ken Burns 효과(오프닝 씬은 항상 `zoom-in` 고정, 이후 씬은 직전 씬과 다른 방향으로 순회) + 자막 번인 + 배경음악 믹싱 → 최종 mp4
   - 렌더링 전 "이미지 재생성 여부 확인", "자막/나레이션 내용 확인" 체크박스 2개를 모두 체크해야 렌더링 버튼 활성화 (완전 자동화 방지용 최소 큐레이션 장치)

## 5. 남은 작업 / 다음 단계 제안

- [ ] TTS word-level timestamp 연동해 자막 타이밍 정밀화 (현재는 씬 duration 기반 근사치)
- [ ] 배경음악 파일 선택 UI (현재는 로컬 경로 직접 입력)
- [ ] 업로드 스케줄러 (일관된 시간대 자동 업로드용, YouTube Data API 연동)
- [ ] 채널 통계 대시보드 (조회수/구독자 추이 → 어떤 카테고리가 잘되는지 추적)
- [ ] 나노바나나 실제 이미지 응답 구조 확인 및 `gemini.js` 파싱 로직 검증
- [ ] 아웃트로 씬 나레이션이 길어질 경우 고정 `durationSec`(2~3초)보다 TTS 오디오가 길어질 수 있음 — `muxClipWithAudio`가 `-shortest` 옵션을 쓰므로 이 경우 오디오가 잘릴 수 있음, 실제 생성 결과로 확인 필요
- [ ] 아웃트로 씬 imagePrompt(구독 버튼/화살표 암시 구도)가 나노바나나에서 실제로 의도대로 나오는지 결과물 검증

## 폴더 구조

```
shorts-generator/
├── backend/
│   ├── src/
│   │   ├── routes/pipeline.js      # API 엔드포인트
│   │   ├── services/               # claude, gemini, tts, ffmpeg
│   │   ├── db/                     # SQLite 스키마 + 이력/쿼터 쿼리
│   │   └── jobs/pipelineState.js   # 상태 머신
│   └── output/                     # 생성된 이미지/오디오/영상 (프로젝트별 폴더)
└── frontend/
    └── src/
        ├── pages/                  # 주제/이미지/나레이션/렌더 4단계 화면
        ├── components/Sidebar.jsx  # 파이프라인 진행 사이드바
        └── api/client.js
```
