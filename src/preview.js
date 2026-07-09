// 산출물 프리뷰 HTML 생성기 — 브라우저에서 영상·썸네일·자막·메타데이터를 한 화면에 검증
// 사용: node src/preview.js <outDir>   →  <outDir>/preview.html
import fs from "node:fs";
import path from "node:path";

function srtToVtt(srt) {
  return "WEBVTT\n\n" + srt.replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, "$1.$2");
}

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);

export function buildPreview(outDir) {
  const abs = path.resolve(outDir);
  const plan = readJson(path.join(abs, "plan.json")) ?? {};
  const seo = readJson(path.join(abs, "seo.json")) ?? {};
  const qa = readJson(path.join(abs, "qa.json")) ?? {};
  const state = readJson(path.join(abs, "state.json")) ?? {};

  const srtPath = path.join(abs, "subs", "final.srt");
  if (fs.existsSync(srtPath)) {
    fs.writeFileSync(path.join(abs, "subs", "final.vtt"), srtToVtt(fs.readFileSync(srtPath, "utf8")));
  }

  const rows = (o) => Object.entries(o)
    .map(([k, v]) => `<tr><th>${k}</th><td>${Array.isArray(v) ? v.join(", ") : String(v)}</td></tr>`)
    .join("");

  const html = `<h1 data-testid="title">${plan.title ?? "(제목 없음)"}</h1>
<p data-testid="topic">주제: ${state.topic ?? "-"} · 훅 점수: ${state.hookScore ?? "-"} · QA: ${qa.pass ? "PASS" : "FAIL"}</p>
<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
  <video data-testid="video" controls width="270" src="final.mp4">
    <track default kind="subtitles" srclang="ko" src="subs/final.vtt">
  </video>
  <img data-testid="thumbnail" width="270" src="thumbnail.jpg" alt="thumbnail">
</div>
<h2>Plan</h2><table>${rows(plan)}</table>
<h2>SEO</h2><table>${rows(seo)}</table>
<h2>QA</h2><table>${rows({ pass: qa.pass, issues: (qa.issues ?? []).join("; ") || "없음", ...(qa.metrics ?? {}) })}</table>
<style>
  body{font-family:-apple-system,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#222}
  table{border-collapse:collapse;width:100%;margin-bottom:16px}
  th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;vertical-align:top;font-size:14px}
  th{background:#f4f4f4;width:150px;white-space:nowrap}
  video,img{border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.15)}
  h1{font-size:22px} h2{font-size:16px;margin-top:24px}
</style>`;

  const out = path.join(abs, "preview.html");
  fs.writeFileSync(out, html);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || "out/browser-test";
  console.log(buildPreview(dir));
}
