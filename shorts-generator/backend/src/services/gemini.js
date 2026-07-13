import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { getTodayUsage, logUsage } from "../db/queries.js";

// 2026-07-13 https://ai.google.dev/gemini-api/docs/models 문서 기준으로 확인한 모델명.
// Google이 자주 업데이트하므로 404가 나면 위 문서에서 재확인할 것.
const NANOBANANA_MODEL = "gemini-2.5-flash-image"; // "나노바나나"
const NANOBANANA_PRO_MODEL = "gemini-3-pro-image"; // "나노바나나 프로"

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** Interactions API 응답에서 이미지 바이너리를 꺼내 저장 */
function saveInteractionImage(interaction, outputPath) {
  const image = interaction.output_image;
  if (!image) throw new Error("이미지 생성 응답에서 이미지 데이터를 찾을 수 없습니다.");

  const buffer = Buffer.from(image.data, "base64");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

const DAILY_LIMIT = Number(process.env.NANOBANANA_DAILY_LIMIT || 100);
const PRO_DAILY_LIMIT = Number(process.env.NANOBANANA_PRO_DAILY_LIMIT || 2);

export function getQuotaStatus() {
  return {
    nanobanana: { used: getTodayUsage("nanobanana"), limit: DAILY_LIMIT },
    nanobananaPro: { used: getTodayUsage("nanobanana_pro"), limit: PRO_DAILY_LIMIT },
  };
}

/**
 * 컷 이미지 생성 (기본 모델).
 * outputDir에 png로 저장하고 파일 경로를 반환.
 */
export async function generateSceneImage(prompt, outputPath) {
  const used = getTodayUsage("nanobanana");
  if (used >= DAILY_LIMIT) {
    throw new Error(`나노바나나 일일 쿼터(${DAILY_LIMIT}장) 소진. 내일 다시 시도하세요.`);
  }

  const interaction = await ai.interactions.create({ model: NANOBANANA_MODEL, input: prompt });
  saveInteractionImage(interaction, outputPath);

  logUsage("nanobanana");
  return outputPath;
}

/**
 * 대표컷/썸네일용 프로 모델 (하루 2장 제한).
 */
export async function generateThumbnailImage(prompt, outputPath) {
  const used = getTodayUsage("nanobanana_pro");
  if (used >= PRO_DAILY_LIMIT) {
    throw new Error(`나노바나나 프로 일일 쿼터(${PRO_DAILY_LIMIT}장) 소진.`);
  }

  const interaction = await ai.interactions.create({ model: NANOBANANA_PRO_MODEL, input: prompt });
  saveInteractionImage(interaction, outputPath);

  logUsage("nanobanana_pro");
  return outputPath;
}
