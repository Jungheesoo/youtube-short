# 만약에 시리즈 — 유튜브 숏츠 자동 제작 웹앱

로컬 컴퓨터에서 실행하는 무료 숏츠 제작 파이프라인.
Claude(대본) → Google AI Studio 수동 생성(이미지) → Google TTS(나레이션) → FFmpeg(합성)

> ⚠️ **이미지 생성은 완전 자동화가 아닙니다.** Gemini 이미지 생성 모델(나노바나나 계열)은
> API로 호출하면 전부 유료입니다(무료 티어 없음 — Nano Banana 2/Pro는 물론 Lite도 API로는 과금).
> 반면 [Google AI Studio](https://aistudio.google.com/) 브라우저 화면에서 직접 생성하면 **Nano
> Banana 2 Lite**(`gemini-3.1-flash-lite-image`)에 한해 무료로 쓸 수 있습니다. 그래서 이 앱은
> 이미지 프롬프트를 자동 생성한 뒤, 사람이 AI Studio에 붙여넣어 생성하고 다운로드한 파일을
> 앱에 업로드하는 방식으로 동작합니다. (`backend/src/services/gemini.js`에 API 자동 생성
> 코드가 남아있지만 기본 플로우에서는 쓰지 않습니다 — 나중에 결제하기로 하면 재사용 가능.)

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
| Claude | https://console.anthropic.com | `ANTHROPIC_API_KEY` (충전 필요, 대본 1개당 약 2~3센트) |
| Google Cloud TTS | GCP 콘솔 → 서비스 계정 JSON 다운로드 | `GOOGLE_APPLICATION_CREDENTIALS` (JSON 파일 경로) |

`GEMINI_API_KEY`는 기본 플로우(AI Studio 수동 생성)에서는 필요 없습니다. 이미지 생성을
나중에 API로 자동화하기로 하면 그때 발급받아 `.env`에 추가하고 `gemini.js`의 API 호출
코드를 다시 연결하면 됩니다.

이미지 생성용으로는 대신 **Google AI Studio 계정**만 있으면 됩니다: https://aistudio.google.com/
접속 → 모델 선택 드롭다운에서 "Nano Banana 2 Lite" 선택(Paid 배지 없는 것 확인) → 채팅창에
프롬프트 붙여넣기 → 생성된 이미지 다운로드. 무료 사용량은 태평양시간(PT) 자정 기준으로
초기화되는 것으로 보이나 정확한 일일 장수 한도는 확인되지 않았습니다.

## 3. 실행

```bash
# 터미널 1
cd backend && npm run dev

# 터미널 2
cd frontend && npm run dev
```

브라우저에서 `http://localhost:5173` 접속.

## 4. 파이프라인 흐름

1. **주제 입력** — 직접 입력 또는 Claude 추천 주제 카드 선택 → 대본 + 제목 후보 3개 + 유튜브 설명(해시태그 포함) 자동 생성
   - 오프닝 씬(#1)은 항상 "시대착오적 오브젝트가 프레임 중심 + 인물 표정/동작이 드러나는, 사건이 벌어지는 중" 구도로 지시
   - 본편 씬 뒤에 구독 유도 + 다음 편 예고용 **아웃트로 씬**을 자동으로 1개 추가 (`sceneType: "outro"`)
2. **이미지 생성 (수동)** — 컷별 카드에서 영어 프롬프트 확인 → "프롬프트 복사" → AI Studio에서 생성/다운로드 → "이미지 업로드"로 앱에 반영. 모든 컷에 이미지가 있어야 다음 단계로 진행 가능. 아웃트로 씬은 "아웃트로" 뱃지로 본편과 구분 표시
3. **나레이션** — 씬별 TTS 생성, SSML로 자연스러운 pause 적용
4. **합성/미리보기** — 각 씬의 실제 TTS 오디오 길이(ffprobe로 측정)를 기준으로 Ken Burns 클립 길이와 자막 타이밍을 동일하게 맞춰 화면전환/자막이 나레이션과 어긋나지 않도록 함. Ken Burns 방향은 오프닝 씬 `zoom-in` 고정, 이후 씬은 직전과 다른 방향으로 순회 + 자막 번인 + 배경음악 믹싱 → 최종 mp4
   - 렌더링 전 "이미지 재생성 여부 확인", "자막/나레이션 내용 확인" 체크박스 2개를 모두 체크해야 렌더링 버튼 활성화 (완전 자동화 방지용 최소 큐레이션 장치)
   - 렌더링 완료 후 제목 후보 3개 + 유튜브 설명을 복사 버튼과 함께 표시

## 5. 남은 작업 / 다음 단계 제안

- [ ] **imagePrompt에 세로 비율(9:16 portrait) 지시가 없음** — AI Studio가 임의로 가로형 이미지를 생성해서 FFmpeg가 세로로 크롭할 때 구도가 망가지는 경우 있음. `claude.js`의 imagePrompt 규칙에 "1080x1920 vertical 9:16 portrait" 같은 지시 추가 필요
- [ ] 배경음악 파일 선택 UI (현재는 로컬 경로 직접 입력)
- [ ] 업로드 스케줄러 (일관된 시간대 자동 업로드용, YouTube Data API 연동)
- [ ] 채널 통계 대시보드 (조회수/구독자 추이 → 어떤 카테고리가 잘되는지 추적)
- [ ] 아웃트로 씬 imagePrompt(구독 버튼/화살표 암시 구도)가 실제로 의도대로 나오는지 결과물 검증
- [ ] 컷별로 AI Studio를 여러 번 오가는 게 번거로우면, 프롬프트를 한 번에 모아 보여주는 화면 추가 고려 (같은 채팅 세션에서 연달아 생성하면 스타일 일관성도 더 좋아질 가능성)

### 해결된 이슈 (기록용)
- ~~TTS word-level timestamp 연동~~ → 각 씬의 실제 오디오 길이를 ffprobe로 측정해서 영상 클립 길이/자막 타이밍에 그대로 사용하는 방식으로 해결
- ~~나노바나나 API 자동 생성~~ → 무료 티어가 없어(전 모델 유료) AI Studio 수동 생성 + 업로드 방식으로 전환

## 폴더 구조

```
shorts-generator/
├── backend/
│   ├── src/
│   │   ├── routes/pipeline.js      # API 엔드포인트
│   │   ├── services/               # claude, gemini(미사용 API 코드), tts, ffmpeg
│   │   ├── db/                     # SQLite 스키마 + 이력/쿼터 쿼리
│   │   ├── jobs/pipelineState.js   # 상태 머신
│   │   └── utils/logger.js         # 에러를 logs/error.log에 기록
│   ├── logs/error.log              # 백엔드 에러 로그 (디버깅용)
│   └── output/                     # 생성된 이미지/오디오/영상 (프로젝트별 폴더)
└── frontend/
    └── src/
        ├── pages/                  # 주제/이미지/나레이션/렌더 4단계 화면
        ├── components/Sidebar.jsx  # 파이프라인 진행 사이드바
        └── api/client.js
```
