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
 * 3분할 레이아웃 비율 (세이프존 반영).
 * 기기별 정확한 세이프존 픽셀 수치(노치/상태바, 유튜브 좋아요·댓글·공유 UI 등)는
 * 기종마다 달라 확정할 수 없음 — 비율 기반 여백으로 대응한다 (미검증, 화면 비율 기준 근사치).
 *
 * 0~15%   상단 제목바 (검은 배경, 고정)
 * 15~75%  이미지 영역 (레터박스 + 블러 배경 채움)
 * 75~100% 하단 브랜딩바 — 실제 콘텐츠(아이콘+채널명)는 75~85%에만, 85~100%는 완전히 비움
 */
const TOP_BAR_H = Math.round(OUT_H * 0.15); // 288
const BOTTOM_BAR_H = Math.round(OUT_H * 0.25); // 480
const IMG_REGION_W = OUT_W;
const IMG_REGION_H = OUT_H - TOP_BAR_H - BOTTOM_BAR_H; // 1152
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
 * 이미지 1장 -> 3분할 레이아웃 캔버스(1080x1920)의 짧은 클립.
 *
 * 이미지 영역(15~75%, 1080x1152)은 원본 이미지를 크롭해서 빈틈없이 꽉 채우고(레터박스/블러 없음),
 * Ken Burns 팬/줌 효과를 적용한다. 마지막에 상/하단 검은 바를 pad로 붙여 최종 1080x1920 캔버스를 만든다.
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
    // 상/하단 검은 바 (고정 브랜딩바 자리)
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

/** 원(재생버튼 배경) - 4개의 3차 베지어 곡선으로 근사한 표준 기법. 로컬 좌표계는 \pos 기준 (0,0)~(iconSize,iconSize) */
function buildCircleDrawPath(iconSize) {
  const r = iconSize / 2;
  const k = Math.round(r * 0.5523);
  const near = r - k;
  const far = r + k;
  return `m ${r} 0 b ${far} 0 ${iconSize} ${near} ${iconSize} ${r} b ${iconSize} ${far} ${far} ${iconSize} ${r} ${iconSize} b ${near} ${iconSize} 0 ${far} 0 ${r} b 0 ${near} ${near} 0 ${r} 0`;
}

/** 재생버튼 삼각형(자체 제작 아이콘 — 유튜브 로고 아님) */
function buildTriangleDrawPath(iconSize) {
  const ax = Math.round(iconSize * 0.32);
  const ay = Math.round(iconSize * 0.25);
  const by = Math.round(iconSize * 0.75);
  const cx = Math.round(iconSize * 0.72);
  const cy = Math.round(iconSize / 2);
  return `m ${ax} ${ay} l ${ax} ${by} l ${cx} ${cy}`;
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
  { title, channelName = "상상채굴단", totalDurationSec } = {}
) {
  const toAssTime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(2);
    return `${h}:${String(m).padStart(2, "0")}:${sec.padStart(5, "0")}`;
  };

  const endSec = totalDurationSec ?? (timings.length ? timings[timings.length - 1].endSec : 0);

  // 캡션(나레이션 자막): 이미지 영역(15~75%) 안쪽, 화면 하단 기준 70% 지점에 텍스트 하단이 오도록
  // MarginV 계산 — 화면 최하단 25%(하단 브랜딩바 세이프존) 안으로는 내려가지 않는다.
  const captionMarginV = Math.round(OUT_H - OUT_H * 0.7); // 576
  // 상단바 제목: 화면 최상단에서 최소 3% 아래부터 시작
  const titleMarginV = Math.round(OUT_H * 0.03); // 58
  // 제목/자막을 화면 중앙에 오도록 좌우 마진을 동일하게(RIGHT_SAFE_MARGIN 기준) — 우측 세이프존도 함께 만족
  const centeredMargin = RIGHT_SAFE_MARGIN;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${OUT_W}
PlayResY: ${OUT_H}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: Caption,NanumSquareRound Bold,68,&H0000FFFF,&H00000000,&H00000000,1,1,5,2,2,${centeredMargin},${centeredMargin},${captionMarginV}
Style: Title,NanumSquareRound Bold,80,&H0000FFFF,&H00000000,&H00000000,1,1,5,2,8,${centeredMargin},${centeredMargin},${titleMarginV}
Style: Channel,NanumSquareRound Bold,66,&H00FFFFFF,&H00000000,&H00000000,1,1,3,1,7,0,0,0
Style: Icon,NanumSquareRound Bold,10,&H00FFFFFF,&H00000000,&H00000000,1,1,0,0,7,0,0,0

[Events]
Format: Layer, Start, End, Style, Text
`;

  const lines = [];

  timings.forEach((t) => {
    lines.push(`Dialogue: 0,${toAssTime(t.startSec)},${toAssTime(t.endSec)},Caption,${escapeAssText(t.text)}`);
  });

  if (title) {
    lines.push(`Dialogue: 0,${toAssTime(0)},${toAssTime(endSec)},Title,${wrapTitleForAss(title)}`);
  }

  // 하단 브랜딩바: 실제 콘텐츠(아이콘+채널명)는 75~85% 구간에만 배치, 85~100%는 완전히 비워둔다
  // (유튜브 좋아요/댓글/공유/채널설명 UI가 겹치는 세이프존). 기기별 정확한 픽셀 수치는 미검증 —
  // 비율 기반 여백으로 대응.
  const bandTop = OUT_H * 0.75;
  const bandBottom = OUT_H * 0.85;
  const iconSize = 90;
  const iconGap = 24;
  const channelFontSize = 66;
  // 채널명 텍스트 폭을 정확히 측정할 폰트 라이브러리가 없어, 한글(CJK) 글자는 대략 정사각형이라는
  // 근사치로 폭을 추정해 아이콘+텍스트를 그룹으로 화면 중앙에 배치한다 (미검증 근사값 — 채널명이
  // 바뀌거나 실제 폰트 렌더링과 차이가 크면 좌우 위치를 눈으로 보고 조정 필요).
  const estimatedTextWidth = Math.round(channelName.length * channelFontSize * 0.95);
  const groupWidth = iconSize + iconGap + estimatedTextWidth;
  const iconLeft = Math.round((OUT_W - groupWidth) / 2);
  const iconTop = Math.round(bandTop + (bandBottom - bandTop - iconSize) / 2);

  lines.push(
    `Dialogue: 0,${toAssTime(0)},${toAssTime(endSec)},Icon,{\\an7\\pos(${iconLeft},${iconTop})\\p1\\bord0\\1c&H1E1EE0&}${buildCircleDrawPath(iconSize)}`
  );
  lines.push(
    `Dialogue: 1,${toAssTime(0)},${toAssTime(endSec)},Icon,{\\an7\\pos(${iconLeft},${iconTop})\\p1\\bord0\\1c&HFFFFFF&}${buildTriangleDrawPath(iconSize)}`
  );

  const channelX = iconLeft + iconSize + iconGap;
  const channelY = iconTop + Math.round(iconSize / 2);
  lines.push(
    `Dialogue: 1,${toAssTime(0)},${toAssTime(endSec)},Channel,{\\an4\\pos(${channelX},${channelY})}${escapeAssText(
      channelName
    )}`
  );

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
          ? ["-filter_complex", "[1:a]volume=0.15[bgm];[0:a][bgm]amix=inputs=2:duration=first", "-c:v libx264"]
          : ["-c:v libx264"]
      )
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject);
  });
}
