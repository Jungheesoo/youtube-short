import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";
import { getTodayUsage, logUsage } from "../db/queries.js";

// ⚠️ 모델명/엔드포인트는 Google이 자주 업데이트합니다.
// 실제 사용 전 https://ai.google.dev/gemini-api/docs/models 에서 최신 이미지 생성 모델명을 확인하세요.
const NANOBANANA_MODEL = "gemini-2.5-flash-image"; // "나노바나나 2" 정식 모델명으로 교체 필요
const NANOBANANA_PRO_MODEL = "gemini-2.5-pro-image"; // "나노바나나 프로" 정식 모델명으로 교체 필요

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

  const model = genAI.getGenerativeModel({ model: NANOBANANA_MODEL });
  const result = await model.generateContent(prompt);

  // 응답에서 이미지 바이너리 추출 (실제 응답 구조는 SDK 버전에 따라 다를 수 있어 확인 필요)
  const imagePart = result.response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!imagePart) throw new Error("이미지 생성 응답에서 이미지 데이터를 찾을 수 없습니다.");

  const buffer = Buffer.from(imagePart.inlineData.data, "base64");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);

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

  const model = genAI.getGenerativeModel({ model: NANOBANANA_PRO_MODEL });
  const result = await model.generateContent(prompt);
  const imagePart = result.response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!imagePart) throw new Error("썸네일 생성 응답에서 이미지 데이터를 찾을 수 없습니다.");

  const buffer = Buffer.from(imagePart.inlineData.data, "base64");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);

  logUsage("nanobanana_pro");
  return outputPath;
}
