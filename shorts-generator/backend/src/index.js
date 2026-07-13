import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import pipelineRoutes from "./routes/pipeline.js";
import "./db/init.js"; // DB 스키마 초기화

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// 생성된 이미지/오디오/영상 파일 미리보기용 정적 서빙
app.use("/output-files", express.static(path.join(process.cwd(), "output")));

app.use("/api", pipelineRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🎬 숏츠 자동 제작 백엔드 실행 중: http://localhost:${PORT}`);
});
