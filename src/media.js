// 미디어 에이전트: Video / Voice / Subtitle / Compose / QA / Thumbnail / Upload
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const run = promisify(execFile);
const EXEC_OPTS = { maxBuffer: 32 * 1024 * 1024 };

function resolveMediaBinary(staticPath, systemCommand, envName) {
  const override = process.env[envName];
  if (override) return override;
  return typeof staticPath === "string" && fs.existsSync(staticPath)
    ? staticPath
    : systemCommand;
}

const FFMPEG_BIN = resolveMediaBinary(ffmpegPath, "ffmpeg", "VIDEO_CREATOR_FFMPEG");
const FFPROBE_BIN = resolveMediaBinary(ffprobeStatic?.path, "ffprobe", "VIDEO_CREATOR_FFPROBE");

const FONT_CANDIDATES = [
  process.env.VIDEO_CREATOR_FONT,
  "/System/Library/Fonts/AppleSDGothicNeo.ttc",
  "/System/Library/Fonts/Helvetica.ttc",
  "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
  "/usr/share/fonts/truetype/nanum/NanumBarunGothic.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
].filter(Boolean);
const FONT = FONT_CANDIDATES.find((f) => fs.existsSync(f));
const FONT_FAMILY = FONT?.includes("AppleSDGothic")
  ? "Apple SD Gothic Neo"
  : FONT?.includes("Nanum")
    ? "NanumGothic"
    : "DejaVu Sans";

function fontFile() {
  if (!FONT) {
    throw new Error(`사용 가능한 폰트 없음: ${FONT_CANDIDATES.join(", ")}`);
  }
  return FONT;
}

async function ffmpeg(args, cwd) {
  return run(FFMPEG_BIN, ["-hide_banner", "-y", ...args], { ...EXEC_OPTS, cwd });
}

export async function probeDuration(file) {
  const { stdout } = await run(FFPROBE_BIN,
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], EXEC_OPTS);
  return parseFloat(stdout.trim());
}

function wrap(text, width = 12) {
  const out = [];
  for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width));
  return out.join("\n");
}

// ---------- Video Agent ----------
// ponytail: Runway/Kling/LTX는 API 키 확보 시 render()만 구현하면 체인에 합류.
// local-ffmpeg가 항상 성공하는 최종 fallback → 파이프라인이 끝까지 돈다.
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const PROVIDERS = [
  { name: "veo", available: !!GEMINI_KEY, render: renderSceneVeo },
  { name: "runway", available: !!process.env.RUNWAY_API_KEY, render: async () => { throw new Error("runway 연동 미구현"); } },
  { name: "kling", available: !!process.env.KLING_API_KEY, render: async () => { throw new Error("kling 연동 미구현"); } },
  { name: "ltx", available: !!process.env.LTX_API_KEY, render: async () => { throw new Error("ltx 연동 미구현"); } },
  { name: "local-ffmpeg", available: true, render: renderSceneLocal },
];

// Veo (Gemini API): 구독 계정의 AI Studio API 키(GEMINI_API_KEY)로 인증
async function renderSceneVeo({ scene, duration, outDir }) {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
  let op = await ai.models.generateVideos({
    model: process.env.VEO_MODEL || "veo-2.0-generate-001",
    prompt: [scene.video_prompt, scene.image_prompt,
      `camera: ${scene.camera_motion}`, `lighting: ${scene.lighting}`, `style: ${scene.style}`,
    ].filter(Boolean).join(". "),
    config: {
      numberOfVideos: 1,
      aspectRatio: "9:16",
      negativePrompt: scene.negative_prompt || undefined,
      durationSeconds: Math.min(8, Math.max(5, Math.ceil(duration))),
    },
  });
  while (!op.done) {
    await new Promise((r) => setTimeout(r, 10_000));
    op = await ai.operations.getVideosOperation({ operation: op });
  }
  const video = op.response?.generatedVideos?.[0]?.video;
  if (!video) {
    throw new Error(`Veo 응답에 영상 없음: ${JSON.stringify(op.error ?? op.response?.raiMediaFilteredReasons ?? "unknown")}`);
  }
  const raw = path.join(outDir, "scenes", `veo_raw_${scene.id}.mp4`);
  await ai.files.download({ file: video, downloadPath: raw });
  // 파이프라인 규격(1080x1920/30fps, scene 길이)으로 정규화 — 짧으면 마지막 프레임 유지, 길면 잘라냄
  const outFile = path.join("scenes", `scene_${scene.id}.mp4`);
  await ffmpeg([
    "-i", raw,
    "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,tpad=stop=-1:stop_mode=clone",
    "-t", duration.toFixed(3), "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", outFile,
  ], outDir);
  return path.join(outDir, outFile);
}

const SCENE_COLORS = ["0x1a1a2e", "0x16213e", "0x0f3460", "0x533483", "0x2b2d42", "0x1b263b"];

async function renderSceneLocal({ scene, index, duration, outDir }) {
  const txt = path.join(outDir, "scenes", `txt_${scene.id}.txt`);
  fs.writeFileSync(txt, wrap(scene.dialogue || scene.visual_goal || ""));
  const outFile = path.join("scenes", `scene_${scene.id}.mp4`);
  const color = SCENE_COLORS[index % SCENE_COLORS.length];
  const vf = `drawtext=fontfile=${fontFile()}:textfile=scenes/txt_${scene.id}.txt:expansion=none:fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=24`;
  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=1080x1920:d=${duration.toFixed(3)}:r=30`,
    "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", outFile,
  ], outDir);
  return path.join(outDir, outFile);
}

export async function videoAgent({ scenes, outDir }) {
  fs.mkdirSync(path.join(outDir, "scenes"), { recursive: true });
  const providers = PROVIDERS.filter((p) => p.available);
  try {
    // scene별 입출력이 독립(scene.id 단위)이라 병렬 렌더링 — 순서는 Promise.all이 보존
    const videos = await Promise.all(scenes.map(async (scene, index) => {
      const errors = [];
      for (const p of providers) {
        try {
          const file = await p.render({ scene, index, duration: scene.duration_sec, outDir });
          return { id: scene.id, video_url: file, provider: p.name };
        } catch (e) {
          errors.push(`${p.name}: ${e.message}`); // 실패 시 다음 Provider
        }
      }
      throw new Error(`scene ${scene.id}: ${errors.join("; ")}`);
    }));
    return { status: "SUCCESS", reason: "모든 scene 렌더링 완료", output: { videos } };
  } catch (e) {
    return { status: "FAIL", reason: e.message, output: {} };
  }
}

// ---------- Voice Agent ----------
async function synthesizeWithSay({ narration, outDir }) {
  const sayPath = "/usr/bin/say";
  if (!fs.existsSync(sayPath)) return null;

  const aiff = path.join(outDir, "voice.aiff");
  for (const args of [["-v", "Yuna", "-o", aiff, narration], ["-o", aiff, narration]]) {
    try {
      fs.rmSync(aiff, { force: true });
      await run(sayPath, args, EXEC_OPTS);
      return { path: aiff, voice: args[0] === "-v" ? "say:Yuna" : "say:system-default" };
    } catch { /* 다음 시도 */ }
  }
  return null;
}

async function synthesizeWithEspeak({ narration, outDir }) {
  const wav = path.join(outDir, "voice.wav");
  const attempts = [
    { voice: "espeak-ng:ko", args: ["-v", "ko", "-s", "155", "-w", wav, narration] },
    { voice: "espeak-ng:default", args: ["-s", "155", "-w", wav, narration] },
  ];

  for (const attempt of attempts) {
    try {
      fs.rmSync(wav, { force: true });
      await run("espeak-ng", attempt.args, EXEC_OPTS);
      return { path: wav, voice: attempt.voice };
    } catch { /* 다음 시도 */ }
  }
  return null;
}

export async function voiceAgent({ narration, estimatedDur, outDir }) {
  const m4a = path.join(outDir, "voice.m4a");
  const speech = await synthesizeWithSay({ narration, outDir })
    ?? await synthesizeWithEspeak({ narration, outDir });

  let voice = speech?.voice ?? null;
  if (speech) {
    await ffmpeg(["-i", speech.path, "-c:a", "aac", "-b:a", "128k", m4a]);
    fs.rmSync(speech.path, { force: true });
  } else {
    // 모든 TTS가 불가한 환경에서도 파이프라인은 완주하도록 낮은 볼륨의 기준음을 생성한다.
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
    `Style: Default,${FONT_FAMILY},64,&H00FFFFFF,&H00000000,3,2,420`, "",
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
    return `drawtext=fontfile=${fontFile()}:textfile=${tf}:expansion=none:fontsize=58:fontcolor=white:borderw=5:bordercolor=black:x=(w-text_w)/2:y=h-460:line_spacing=16:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'`;
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
  // 메타데이터(스트림+길이)는 ffprobe 1회, 콘텐츠 분석(음량+검은화면)은 디코드 1회로 조회
  const { stdout: probe } = await run(FFPROBE_BIN,
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "csv=p=0", finalPath], EXEC_OPTS);
  const lines = probe.trim().split("\n");
  const duration = parseFloat(lines.at(-1)); // stream 항목들 뒤에 format(duration)이 출력됨
  if (Math.abs(duration - expectedDur) > 2.5) {
    issues.push(`길이/싱크 불일치: ${duration.toFixed(1)}s (기대 ${expectedDur.toFixed(1)}s)`);
  }
  if (!lines.includes("video")) issues.push("비디오 스트림 없음(검은 화면/깨짐)");
  if (!lines.includes("audio")) issues.push("오디오 스트림 없음");

  let meanVol = null;
  try {
    const { stderr } = await run(FFMPEG_BIN,
      ["-i", finalPath, "-af", "volumedetect", "-vf", "blackdetect=d=1.5:pic_th=0.99", "-f", "null", "-"], EXEC_OPTS);
    meanVol = parseFloat(stderr.match(/mean_volume:\s*(-?[\d.]+)/)?.[1]);
    if (meanVol > -2) issues.push(`음량 과다/clipping 의심: ${meanVol}dB`);
    if (meanVol < -45) issues.push(`음량 과소: ${meanVol}dB`);
    if (stderr.includes("black_start")) issues.push("검은 화면 구간 감지");
  } catch { issues.push("음량/화면 분석 실패"); }

  // 판정을 산출했으면 SUCCESS — pass/fail은 output 데이터 (Director가 재시도 여부 결정)
  const pass = issues.length === 0;
  return {
    status: "SUCCESS",
    reason: pass ? "QA 통과" : issues.join("; "),
    output: { pass, issues, metrics: { duration, mean_volume: meanVol } },
  };
}

// ---------- Thumbnail Agent ----------
export async function thumbnailAgent({ finalPath, title, outDir }) {
  const tf = path.join(outDir, "thumb_title.txt");
  fs.writeFileSync(tf, wrap(title, 10));
  const thumbPath = path.join(outDir, "thumbnail.jpg");
  const vf = `drawtext=fontfile=${fontFile()}:textfile=${tf}:expansion=none:fontsize=96:fontcolor=white:borderw=6:bordercolor=black:box=1:boxcolor=black@0.45:boxborderw=28:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=20`;
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
