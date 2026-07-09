#!/usr/bin/env node
// 사용법: node run.js [--topic "주제"] [--mock] [--bgm path/to.mp3]
// 실제 실행에는 ANTHROPIC_API_KEY 필요. --mock은 LLM 없이 파이프라인만 검증.
import path from "node:path";
import { runWorkflow } from "./src/director.js";

const args = process.argv.slice(2);
const getFlag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
if (args.includes("--mock")) process.env.MOCK = "1";

const outDir = path.resolve("out", new Date().toISOString().replace(/[:.]/g, "-"));

try {
  const state = await runWorkflow({
    topic: getFlag("topic"),
    bgmPath: getFlag("bgm"),
    outDir,
  });
  console.log("\n✅ 완료");
  console.log(`  주제:     ${state.topic}`);
  console.log(`  영상:     ${state.artifacts.final}`);
  console.log(`  썸네일:   ${state.artifacts.thumbnail}`);
  console.log(`  업로드:   ${state.artifacts.upload} (DRY_RUN)`);
  if (state.warnings.length) console.log(`  ⚠ 경고:  ${state.warnings.join(" / ")}`);
} catch (e) {
  console.error(`\n❌ Workflow 중단: ${e.message}`);
  console.error(`  상태 파일: ${path.join(outDir, "state.json")}`);
  process.exit(1);
}
