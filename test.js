// self-check: MOCK LLM으로 전체 파이프라인(Voice→Video→Subtitle→Compose→QA→Thumbnail→Upload)을 실주행
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

process.env.MOCK = "1";
const { runWorkflow } = await import("./src/director.js");
const { probeDuration } = await import("./src/media.js");

const outDir = path.resolve("out", "test-run");
fs.rmSync(outDir, { recursive: true, force: true });

const state = await runWorkflow({ outDir, log: () => {} });

assert.ok(fs.existsSync(state.artifacts.final), "final.mp4 없음");
assert.ok(fs.existsSync(state.artifacts.thumbnail), "thumbnail.jpg 없음");
assert.ok(fs.existsSync(state.artifacts.subtitles.srt), "final.srt 없음");
assert.ok(fs.existsSync(state.artifacts.subtitles.ass), "final.ass 없음");
assert.ok(fs.existsSync(state.artifacts.upload), "upload.json 없음");

const dur = await probeDuration(state.artifacts.final);
assert.ok(dur > 3, `영상이 너무 짧음: ${dur}s`);

const failed = Object.entries(state.steps).filter(([, s]) => !["SUCCESS", "SKIP"].includes(s.status));
assert.deepStrictEqual(failed, [], `실패한 step: ${JSON.stringify(failed)}`);

console.log(`✅ self-check 통과 — final.mp4 ${dur.toFixed(1)}s, steps: ${Object.keys(state.steps).length}개 SUCCESS`);
