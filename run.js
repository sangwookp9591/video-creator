#!/usr/bin/env node
// 사용법: node run.js [--topic "주제"] [--mock] [--bgm path/to.mp3]
// 실제 실행에는 ANTHROPIC_API_KEY 필요. --mock은 LLM 없이 파이프라인만 검증.
import path from "node:path";
import { parseArgs } from "node:util";
import { ensureAuth } from "./src/auth.js";

const { values: flags } = parseArgs({
  options: {
    topic: { type: "string" },
    bgm: { type: "string" },
    mock: { type: "boolean", default: false },
  },
});
if (flags.mock) process.env.MOCK = "1";

try {
  await ensureAuth(); // 최초 실행 시 인증 화면 (자격 증명 있으면 통과)
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
}
const { runWorkflow } = await import("./src/director.js"); // 인증 후 로드 (env 반영)

const outDir = path.resolve("out", new Date().toISOString().replace(/[:.]/g, "-"));

try {
  const state = await runWorkflow({
    topic: flags.topic ?? null,
    bgmPath: flags.bgm ?? null,
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
