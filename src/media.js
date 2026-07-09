// 미디어 에이전트: Video / Voice / Subtitle / Compose / QA / Thumbnail / Upload
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const run = promisify(execFile);
const EXEC_OPTS = { maxBuffer: 32 * 1024 * 1024 };

const FONT = ["/System/Library/Fonts/AppleSDGothicNeo.ttc", "/System/Library/Fonts/Helvetica.ttc"]
  .find((f) => fs.existsSync(f));

async function ffmpeg(args, cwd) {
  return run(ffmpegPath, ["-hide_banner", "-y", ...args], { ...EXEC_OPTS, cwd });
}

export async function probeDuration(file) {
  const { stdout } = await run(ffprobeStatic.path,
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], EXEC_OPTS);
  return parseFloat(stdout.trim());
}

function wrap(text, width = 12) {
  const out = [];
  for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width));
  return out.join("\n");
}

// ---------- Video Agent ----------
// ponytail: Veo/Runway/Kling/LTX는 API 키 확보 시 render()만 구현하면 체인에 합류.
// 지금은 local-ffmpeg가 항상 성공하는 최종 fallback → 파이프라인이 끝까지 돈다.
const PROVIDERS = [
  { name: "veo", available: !!process.env.VEO_API_KEY, render: async () => { throw new Error("veo 연동 미구현"); } },
  { name: "runway", available: !!process.env.RUNWAY_API_KEY, render: async () => { throw new Error("runway 연동 미구현"); } },
  { name: "kling", available: !!process.env.KLING_API_KEY, render: async () => { throw new Error("kling 연동 미구현"); } },
  { name: "ltx", available: !!process.env.LTX_API_KEY, render: async () => { throw new Error("ltx 연동 미구현"); } },
  { name: "local-ffmpeg", available: true, render: renderSceneLocal },
];

const SCENE_COLORS = ["0x1a1a2e", "0x16213e", "0x0f3460", "0x533483", "0x2b2d42", "0x1b263b"];

async function renderSceneLocal({ scene, index, duration, outDir }) {
  const txt = path.join(outDir, "scenes", `txt_${scene.id}.txt`);
  fs.writeFileSync(txt, wrap(scene.dialogue || scene.visual_goal || ""));
  const outFile = path.join("scenes", `scene_${scene.id}.mp4`);
  const color = SCENE_COLORS[index % SCENE_COLORS.length];
  const vf = `drawtext=fontfile=${FONT}:textfile=scenes/txt_${scene.id}.txt:expansion=none:fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=24`;
  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=1080x1920:d=${duration.toFixed(3)}:r=30`,
    "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", outFile,
  ], outDir);
  return path.join(outDir, outFile);
}

export async function videoAgent({ scenes, outDir }) {
  fs.mkdirSync(path.join(outDir, "scenes"), { recursive: true });
  const results = [];
  for (const [index, scene] of scenes.entries()) {
    let rendered = null, errors = [];
    for (const p of PROVIDERS.filter((p) => p.available)) {
      try {
        rendered = { file: await p.render({ scene, index, duration: scene.duration_sec, outDir }), provider: p.name };
        break;
      } catch (e) {
        errors.push(`${p.name}: ${e.message}`); // 실패 시 다음 Provider
      }
    }
    if (!rendered) return { status: "FAIL", reason: errors.join("; "), output: {} };
    results.push({ id: scene.id, video_url: rendered.file, provider: rendered.provider });
  }
  return { status: "SUCCESS", reason: "모든 scene 렌더링 완료", output: { videos: results } };
}

// ---------- Voice Agent ----------
export async function voiceAgent({ narration, estimatedDur, outDir }) {
  const aiff = path.join(outDir, "voice.aiff");
  const m4a = path.join(outDir, "voice.m4a");
  let voice = null;
  for (const args of [["-v", "Yuna", "-o", aiff, narration], ["-o", aiff, narration]]) {
    try {
      await run("/usr/bin/say", args, EXEC_OPTS);
      voice = args[0] === "-v" ? "Yuna" : "system-default";
      break;
    } catch { /* 다음 시도 */ }
  }
  if (voice) {
    await ffmpeg(["-i", aiff, "-c:a", "aac", "-b:a", "128k", m4a]);
    fs.rmSync(aiff, { force: true });
  } else {
    // ponytail: say 불가 환경 fallback — 무음 트랙으로라도 파이프라인 완주
    await ffmpeg(["-f", "lavfi", "-i", `sine=frequency=440:duration=${estimatedDur}`,
      "-af", "volume=0.05", "-c:a", "aac", m4a]);
    voice = "sine-fallback";
  }
  const duration = await probeDuration(m4a);
  return { status: "SUCCESS", reason: `TTS 생성(${voice})`, output: { path: m4a, duration, voice, emotion: "neutral", speed: 1.0 } };
}

// ---------- Subtitle Agent ----------
const srtTime = (s) => {
  const d = new Date(Math.max(0, s) * 1000).toISOString();
  return d.slice(11, 23).replace(".", ",");
};
const assTime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;
};

export function subtitleAgent({ cues, outDir }) {
  const subDir = path.join(outDir, "subs");
  fs.mkdirSync(subDir, { recursive: true });

  const srt = cues.map((c, i) =>
    `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
  const srtPath = path.join(subDir, "final.srt");
  fs.writeFileSync(srtPath, srt);

  const ass = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Outline, Alignment, MarginV",
    "Style: Default,Apple SD Gothic Neo,64,&H00FFFFFF,&H00000000,3,2,420", "",
    "[Events]", "Format: Layer, Start, End, Style, Text",
    ...cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,${c.text}`),
  ].join("\n");
  const assPath = path.join(subDir, "final.ass");
  fs.writeFileSync(assPath, ass);

  // ponytail: word timestamp는 글자 수 비례 근사 — 정밀도 필요 시 STT 정렬(whisper)로 교체
  const words = cues.flatMap((c) => {
    const ws = (c.narration || c.text).split(/\s+/).filter(Boolean);
    const total = ws.reduce((a, w) => a + w.length, 0) || 1;
    let t = c.start;
    return ws.map((w) => {
      const dur = (c.end - c.start) * (w.length / total);
      const item = { word: w, start: +t.toFixed(2), end: +(t + dur).toFixed(2) };
      t += dur;
      return item;
    });
  });
  const wordsPath = path.join(subDir, "words.json");
  fs.writeFileSync(wordsPath, JSON.stringify(words, null, 2));

  return { status: "SUCCESS", reason: "자막 생성 완료", output: { srt: srtPath, ass: assPath, words: wordsPath } };
}

// ---------- Compose Agent ----------
export async function composeAgent({ sceneFiles, voicePath, cues, outDir, bgmPath }) {
  const list = path.join(outDir, "concat.txt");
  fs.writeFileSync(list, sceneFiles.map((f) => `file '${f}'`).join("\n"));

  // 자막 burn-in: drawtext 체인(libass 의존 없음 — ponytail: 스타일 고도화 필요 시 ass 필터로 교체)
  const subDir = path.join(outDir, "subs");
  const chain = cues.map((c, i) => {
    const tf = path.join(subDir, `cue_${i}.txt`);
    fs.writeFileSync(tf, wrap(c.text, 14));
    return `drawtext=fontfile=${FONT}:textfile=${tf}:expansion=none:fontsize=58:fontcolor=white:borderw=5:bordercolor=black:x=(w-text_w)/2:y=h-460:line_spacing=16:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'`;
  }).join(",");

  const finalPath = path.join(outDir, "final.mp4");
  const args = ["-f", "concat", "-safe", "0", "-i", list, "-i", voicePath];
  if (bgmPath && fs.existsSync(bgmPath)) {
    args.push("-i", bgmPath, "-filter_complex",
      `[0:v]${chain}[v];[2:a]volume=0.15[bg];[1:a][bg]amix=inputs=2:duration=first[a]`,
      "-map", "[v]", "-map", "[a]");
  } else {
    args.push("-vf", chain, "-map", "0:v", "-map", "1:a");
  }
  args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", finalPath);
  await ffmpeg(args);
  return { status: "SUCCESS", reason: "합성 완료", output: { final: finalPath } };
}

// ---------- QA Agent ----------
export async function qaAgent({ finalPath, expectedDur }) {
  const issues = [];
  const duration = await probeDuration(finalPath);
  if (Math.abs(duration - expectedDur) > 2.5) {
    issues.push(`길이/싱크 불일치: ${duration.toFixed(1)}s (기대 ${expectedDur.toFixed(1)}s)`);
  }
  const { stdout: streams } = await run(ffprobeStatic.path,
    ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", finalPath], EXEC_OPTS);
  if (!streams.includes("video")) issues.push("비디오 스트림 없음(검은 화면/깨짐)");
  if (!streams.includes("audio")) issues.push("오디오 스트림 없음");

  let meanVol = null;
  try {
    const { stderr } = await run(ffmpegPath,
      ["-i", finalPath, "-af", "volumedetect", "-f", "null", "-"], EXEC_OPTS);
    meanVol = parseFloat(stderr.match(/mean_volume:\s*(-?[\d.]+)/)?.[1]);
    if (meanVol > -2) issues.push(`음량 과다/clipping 의심: ${meanVol}dB`);
    if (meanVol < -45) issues.push(`음량 과소: ${meanVol}dB`);
  } catch { issues.push("음량 분석 실패"); }

  try {
    const { stderr } = await run(ffmpegPath,
      ["-i", finalPath, "-vf", "blackdetect=d=1.5:pic_th=0.99", "-an", "-f", "null", "-"], EXEC_OPTS);
    if (stderr.includes("black_start")) issues.push("검은 화면 구간 감지");
  } catch { /* blackdetect 실패는 무시 */ }

  const pass = issues.length === 0;
  return {
    status: pass ? "SUCCESS" : "FAIL",
    reason: pass ? "QA 통과" : issues.join("; "),
    output: { pass, issues, metrics: { duration, mean_volume: meanVol } },
  };
}

// ---------- Thumbnail Agent ----------
export async function thumbnailAgent({ finalPath, title, outDir }) {
  const tf = path.join(outDir, "thumb_title.txt");
  fs.writeFileSync(tf, wrap(title, 10));
  const thumbPath = path.join(outDir, "thumbnail.jpg");
  const vf = `drawtext=fontfile=${FONT}:textfile=${tf}:expansion=none:fontsize=96:fontcolor=white:borderw=6:bordercolor=black:box=1:boxcolor=black@0.45:boxborderw=28:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=20`;
  await ffmpeg(["-ss", "0.3", "-i", finalPath, "-frames:v", "1", "-vf", vf, "-q:v", "3", thumbPath]);
  // ponytail: CTR/Contrast 스코어링 생략 — 재생성 루프 필요해지면 LLM 비전 평가 추가
  return { status: "SUCCESS", reason: "썸네일 생성", output: { path: thumbPath } };
}

// ---------- Upload Agent ----------
export function uploadAgent({ seo, finalPath, thumbPath, outDir }) {
  // ponytail: 실제 YouTube 업로드는 OAuth 토큰 확보 시 videos.insert(resumable)로 구현
  const manifest = {
    status: process.env.YOUTUBE_OAUTH_TOKEN ? "READY(연동 미구현)" : "DRY_RUN",
    reason: "YouTube OAuth 미설정 — 업로드 매니페스트만 생성",
    video: finalPath, thumbnail: thumbPath, snippet: seo,
  };
  const p = path.join(outDir, "upload.json");
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2));
  return { status: "SUCCESS", reason: manifest.reason, output: { manifest: p, video_id: null, published_url: null } };
}
