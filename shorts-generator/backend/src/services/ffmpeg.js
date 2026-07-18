import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";

const ZOOM_DIRECTIONS = ["zoom-in", "zoom-out", "pan-left", "pan-right"];

/** 직전 씬과 다른 방향을 랜덤으로 골라 연속 중복(예: 줌인->줌인)을 방지 */
export function pickDirection(excludeDirection) {
  const candidates = excludeDirection
    ? ZOOM_DIRECTIONS.filter((d) => d !== excludeDirection)
    : ZOOM_DIRECTIONS;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** 세로형 쇼츠 규격 */
const OUT_W = 1080;
const OUT_H = 1920;

/**
 * 2분할 레이아웃 비율.
 * 채널 구독/설명/검색어 UI는 유튜브 자체 플레이어가 영상 밖에 그려주므로(영상 파일 안에는 없음),
 * 영상에는 하단 브랜딩바를 별도로 만들지 않는다 — 제목바 아래는 이미지 영역이 끝까지 채운다.
 * 기기별 정확한 세이프존 픽셀 수치(노치/상태바, 유튜브 좋아요·댓글·공유 UI 등)는 기종마다 달라
 * 확정할 수 없음 — 비율 기반 여백으로 대응한다 (미검증, 화면 비율 기준 근사치).
 *
 * 0~20%   상단 제목바 (검은 배경, 고정) — 아이폰 노치/유튜브 재생 컨트롤과 겹쳐 제목이 잘린다는
 *          피드백으로 15%→20% 확장 (기기별 정확한 수치는 미검증)
 * 20~100% 이미지 영역 (자르기 채움), 자막은 그 안쪽 하단부에 오버레이
 */
const TOP_BAR_H = Math.round(OUT_H * 0.2); // 384
const IMG_REGION_W = OUT_W;
const IMG_REGION_H = OUT_H - TOP_BAR_H; // 1632
const RIGHT_SAFE_MARGIN = Math.round(OUT_W * 0.15); // 162 — 우측 유튜브 버튼 컬럼과 겹치지 않게

function zoompanFilter(direction, durationSec, fps = 30, w = OUT_W, h = OUT_H) {
  const frames = Math.round(durationSec * fps);
  const zoomStep = 0.0015;
  switch (direction) {
    case "zoom-in":
      return `zoompan=z='min(zoom+${zoomStep},1.3)':d=${frames}:s=${w}x${h}:fps=${fps}`;
    case "zoom-out":
      return `zoompan=z='if(eq(on,0),1.3,max(zoom-${zoomStep},1))':d=${frames}:s=${w}x${h}:fps=${fps}`;
    case "pan-left":
      return `zoompan=z='1.2':x='if(eq(on,0),iw*0.2,x-2)':d=${frames}:s=${w}x${h}:fps=${fps}`;
    case "pan-right":
      return `zoompan=z='1.2':x='if(eq(on,0),0,x+2)':d=${frames}:s=${w}x${h}:fps=${fps}`;
    default:
      return `zoompan=z='min(zoom+${zoomStep},1.3)':d=${frames}:s=${w}x${h}:fps=${fps}`;
  }
}

/** 오디오 파일의 실제 재생 길이(초)를 ffprobe로 측정 */
export function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

/**
 * 이미지 1장 -> 2분할 레이아웃 캔버스(1080x1920)의 짧은 클립.
 *
 * 이미지 영역(15~100%, 1080x1632)은 원본 이미지를 크롭해서 빈틈없이 꽉 채우고(레터박스/블러 없음),
 * Ken Burns 팬/줌 효과를 적용한다. 마지막에 상단 검은 바만 pad로 붙여 최종 1080x1920 캔버스를 만든다
 * (하단 브랜딩바는 없음 — 유튜브 자체 UI가 영상 밖에서 담당).
 */
export function imageToClip(imagePath, durationSec, outputPath, direction = pickDirection()) {
  const fps = 30;
  const filterComplex = [
    `[0:v]scale=${IMG_REGION_W * 2}:${IMG_REGION_H * 2}:force_original_aspect_ratio=increase,crop=${IMG_REGION_W * 2}:${IMG_REGION_H * 2},${zoompanFilter(
      direction,
      durationSec,
      fps,
      IMG_REGION_W,
      IMG_REGION_H
    )}[img]`,
    // 상단 검은 바 (제목바 자리) — 하단은 이미지가 그대로 프레임 끝까지 채움
    `[img]pad=${OUT_W}:${OUT_H}:0:${TOP_BAR_H}:color=black[outv]`,
  ].join(";");

  return new Promise((resolve, reject) => {
    ffmpeg(imagePath)
      .loop(durationSec)
      .outputOptions([
        "-filter_complex", filterComplex,
        "-map", "[outv]",
        "-pix_fmt", "yuv420p",
        "-r", String(fps),
      ])
      .duration(durationSec)
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject);
  });
}

/** 클립 + 나레이션 오디오 합치기 */
export function muxClipWithAudio(clipPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(clipPath)
      .input(audioPath)
      .outputOptions(["-c:v copy", "-c:a aac", "-shortest"])
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject);
  });
}

/** 여러 씬 클립을 하나로 이어붙이기 (concat demuxer 사용) */
export function concatClips(clipPaths, outputPath, workDir) {
  const listPath = path.join(workDir, "concat_list.txt");
  const listContent = clipPaths.map((p) => `file '${path.resolve(p)}'`).join("\n");
  fs.writeFileSync(listPath, listContent);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"])
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject);
  });
}

/** ASS override 태그가 텍스트에 섞여 깨지지 않도록 최소한의 이스케이프 처리 */
function escapeAssText(text) {
  return String(text)
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, "\\N");
}

/** 제목을 2줄 이내로 줄바꿈 (공백 기준으로 중앙에 가까운 지점에서 자르고, 없으면 글자수 기준 강제 분할) */
function wrapTitleForAss(title, maxCharsPerLine = 8) {
  const clean = String(title).trim();
  if (clean.length <= maxCharsPerLine) return escapeAssText(clean);

  const mid = Math.ceil(clean.length / 2);
  let breakAt = clean.lastIndexOf(" ", mid);
  if (breakAt <= 0) breakAt = mid;
  const line1 = clean.slice(0, breakAt).trim();
  const line2 = clean.slice(breakAt).trim();
  return `${escapeAssText(line1)}\\N${escapeAssText(line2)}`;
}

/**
 * .ass 자막 파일 생성 (drawtext보다 스타일링/줄바꿈 처리가 쉬움).
 * timings: [{ text, startSec, endSec }] — 이미지 영역 안쪽 하단(55~70% 지점)에 나레이션 자막으로 번인.
 *
 * title이 주어지면 상단바 제목(화면 전체 구간 고정 노출)과 하단 브랜딩바(재생버튼 아이콘 + 채널명)도
 * 같은 .ass 파일 안에 함께 그린다 — 원/삼각형은 벡터 드로잉(ASS \p1)으로 직접 그려서 별도 이미지
 * 에셋이나 폰트 글리프에 의존하지 않는다.
 */
export function generateAssSubtitle(
  timings,
  outputPath,
  { title, totalDurationSec } = {}
) {
  const toAssTime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(2);
    return `${h}:${String(m).padStart(2, "0")}:${sec.padStart(5, "0")}`;
  };

  const endSec = totalDurationSec ?? (timings.length ? timings[timings.length - 1].endSec : 0);

  // 캡션(나레이션 자막): 이미지 영역(15~100%) 안쪽, 화면 하단 기준 70% 지점에 텍스트 하단이 오도록
  // MarginV 계산 — 화면 최하단부는 모바일 유튜브 자체 UI(좋아요/댓글/채널 정보 등)가 겹칠 수 있는
  // 영역이라 여유를 둔다.
  const captionMarginV = Math.round(OUT_H - OUT_H * 0.7); // 576
  // 상단바 제목: 아이폰 노치/유튜브 재생 컨트롤 아이콘과 겹쳐 첫 줄이 잘린다는 실사용 피드백으로
  // 여백을 3%→7%로 늘림 (기기별 정확한 세이프존 수치는 미검증 — 비율 기반 여백으로 대응)
  const titleMarginV = Math.round(OUT_H * 0.055); // 106
  // 제목/자막을 화면 중앙에 오도록 좌우 마진을 동일하게(RIGHT_SAFE_MARGIN 기준) — 우측 세이프존도 함께 만족
  const centeredMargin = RIGHT_SAFE_MARGIN;

  // 상단 제목 글로우 효과: 같은 텍스트를 두 번 그린다 — 아래(Layer 0) TitleGlow는 TITLE_GOLD와 같은
  // 색을 60% 불투명도로 두껍게 그려 부드러운 후광을, 위(Layer 1) Title은 TITLE_GOLD를 100% 불투명도로
  // 선명하게 겹친다. ASS 색상은 &HAABBGGRR(알파-BGR) 형식이라 알파만 낮춰도 같은 색조를 유지한 채
  // 후광 느낌을 낼 수 있다 — ASS Layer 숫자가 높을수록 위에 그려지는 동작 자체는 정상(libass 0.17.5,
  // 공식 문서: https://github.com/libass/libass/wiki/ASSv5-Override-Tags).
  const TITLE_GOLD_GLOW = "&H665ADCF0"; // #F0DC5A, 알파 0x66(약 60% 불투명) — 후광
  const TITLE_GOLD = "&H005ADCF0"; // #F0DC5A, 알파 0x00(완전 불투명) — 글자(선명 레이어)
  // TitleGlow/Title의 Bold를 0으로 둔 이유: "Noto Sans KR Black"은 이미 폰트 자체가 가장 두꺼운
  // 웨이트라, ASS Bold=1(합성 볼드)을 그 위에 얹으면 "돌"처럼 획이 촘촘한 글자(ㄷ+ㅗ+ㄹ)의 내부
  // 여백이 Outline/blur와 겹쳐 뭉개지는 문제가 실제로 재현됐다(ffmpeg -f lavfi 프레임 렌더링으로
  // 확인, 2026-07-17). Bold=0으로 낮추니 해결됨 — Fontsize 104가 이미 충분히 두꺼워 보이므로 시각적
  // 두께 손실은 없음.
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${OUT_W}
PlayResY: ${OUT_H}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Caption,Noto Sans KR Black,68,&H0000FFFF,&H00000000,&H00000000,1,1,1,5,2,2,${centeredMargin},${centeredMargin},${captionMarginV}
Style: TitleGlow,Noto Sans KR Black,104,${TITLE_GOLD_GLOW},${TITLE_GOLD_GLOW},&H00000000,0,0,1,6,0,8,${centeredMargin},${centeredMargin},${titleMarginV}
Style: Title,Noto Sans KR Black,104,${TITLE_GOLD},${TITLE_GOLD},&H00000000,0,0,1,2,0,8,${centeredMargin},${centeredMargin},${titleMarginV}

[Events]
Format: Layer, Start, End, Style, Text
`;

  const lines = [];

  timings.forEach((t) => {
    lines.push(`Dialogue: 0,${toAssTime(t.startSec)},${toAssTime(t.endSec)},Caption,${escapeAssText(t.text)}`);
  });

  if (title) {
    const wrapped = wrapTitleForAss(title);
    lines.push(`Dialogue: 0,${toAssTime(0)},${toAssTime(endSec)},TitleGlow,{\\blur2}${wrapped}`);
    lines.push(`Dialogue: 1,${toAssTime(0)},${toAssTime(endSec)},Title,{\\blur0}${wrapped}`);
  }

  // 하단 브랜딩바: 실제 콘텐츠(아이콘+채널명)는 75~85% 구간에만 배치, 85~100%는 완전히 비워둔다
  // (유튜브 좋아요/댓글/공유/채널설명 UI가 겹치는 세이프존). 기기별 정확한 픽셀 수치는 미검증 —
  // 비율 기반 여백으로 대응.
  // 재생버튼 아이콘 + 채널명은 "구독 요구" 느낌이 감동을 깰 수 있다는 피드백으로 제거함.
  // 하단 25% 세이프존(검은 바) 자체는 유튜브 UI 겹침 방지 목적이라 그대로 유지 (imageToClip의 pad).

  fs.writeFileSync(outputPath, header + lines.join("\n"));
  return outputPath;
}

/**
 * 최종 영상에 자막 번인 + 배경음악 믹스.
 *
 * subtitles= 필터는 인자를 자체적으로 key:value로 파싱해서, Windows 드라이브 문자(C:\...)가
 * 섞인 절대경로를 넘기면 이스케이프를 해도 깨진다 (실제 재현 확인됨). 대신 .ass 파일이 있는
 * 디렉터리를 ffmpeg 프로세스의 작업 디렉터리(cwd)로 지정하고 파일명만 상대경로로 넘긴다.
 */
export function finalizeWithSubtitlesAndMusic(videoPath, assPath, musicPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(videoPath, { cwd: path.dirname(assPath) });
    if (musicPath) cmd.input(musicPath);

    cmd
      .videoFilters([`subtitles=${path.basename(assPath)}`])
      .outputOptions(
        musicPath
          ? ["-filter_complex", "[1:a]volume=0.2[bgm];[0:a][bgm]amix=inputs=2:duration=first", "-c:v libx264"]
          : ["-c:v libx264"]
      )
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject);
  });
}
