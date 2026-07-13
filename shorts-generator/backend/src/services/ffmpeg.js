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

function zoompanFilter(direction, durationSec, fps = 30) {
  const frames = Math.round(durationSec * fps);
  const zoomStep = 0.0015;
  switch (direction) {
    case "zoom-in":
      return `zoompan=z='min(zoom+${zoomStep},1.3)':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${fps}`;
    case "zoom-out":
      return `zoompan=z='if(eq(on,0),1.3,max(zoom-${zoomStep},1))':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${fps}`;
    case "pan-left":
      return `zoompan=z='1.2':x='if(eq(on,0),iw*0.2,x-2)':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${fps}`;
    case "pan-right":
      return `zoompan=z='1.2':x='if(eq(on,0),0,x+2)':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${fps}`;
    default:
      return `zoompan=z='min(zoom+${zoomStep},1.3)':d=${frames}:s=${OUT_W}x${OUT_H}:fps=${fps}`;
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

/** 이미지 1장 -> Ken Burns 효과가 적용된 짧은 클립 */
export function imageToClip(imagePath, durationSec, outputPath, direction = pickDirection()) {
  return new Promise((resolve, reject) => {
    ffmpeg(imagePath)
      .loop(durationSec)
      .videoFilters([
        `scale=${OUT_W * 2}:${OUT_H * 2}:force_original_aspect_ratio=increase,crop=${OUT_W * 2}:${OUT_H * 2}`,
        zoompanFilter(direction, durationSec),
      ])
      .outputOptions(["-pix_fmt yuv420p", "-r 30"])
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

/**
 * .ass 자막 파일 생성 (drawtext보다 스타일링/줄바꿈 처리가 쉬움).
 * timings: [{ text, startSec, endSec }]
 */
export function generateAssSubtitle(timings, outputPath) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${OUT_W}
PlayResY: ${OUT_H}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, Outline, Shadow, Alignment, MarginV
Style: Default,NanumSquareRound Bold,64,&H00FFFFFF,&H00000000,1,3,1,2,120

[Events]
Format: Layer, Start, End, Style, Text
`;
  const toAssTime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(2);
    return `${h}:${String(m).padStart(2, "0")}:${sec.padStart(5, "0")}`;
  };

  const lines = timings
    .map((t) => `Dialogue: 0,${toAssTime(t.startSec)},${toAssTime(t.endSec)},Default,${t.text}`)
    .join("\n");

  fs.writeFileSync(outputPath, header + lines);
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
