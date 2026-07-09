import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { ensureAuth } from "./auth.js";
import { runWorkflow } from "./director.js";
import { CLAUDE_MODELS, GEMINI_VIDEO_MODELS, LOCAL_VIDEO_MODELS, OPENAI_MODELS } from "./providers.js";

export const STEP_ORDER = [
  "trend",
  "research",
  "planner",
  "seo",
  "script",
  "hookqa",
  "storyboard",
  "prompt",
  "voice",
  "video",
  "subtitle",
  "compose",
  "qa",
  "thumbnail",
  "upload",
];

export const OUT_ROOT = path.resolve("out");
export const DEFAULT_MASCOT_IMAGE_URL = "/mascots/aing.png";
export const DEFAULT_CHARACTER_PROMPT = "Ai-ng, a cute white AI cat mascot with cyan-blue headset, transparent smart visor with a brain icon, one eye winking, cheerful helper personality, clean Korean tech brand style";
export const DEFAULT_MASCOT_PROMPT = "Ai-ng mascot: white cat, cyan and lavender AI headset, wink expression, laptop, thumbs-up pose, soft pastel tech illustration, friendly coding assistant";

const store = globalThis.__VIDEO_CREATOR_RUN_STORE__ ?? {
  activeRunId: null,
  jobs: new Map(),
};
globalThis.__VIDEO_CREATOR_RUN_STORE__ = store;

function eventPayload(event, data) {
  return { event, data, at: new Date().toISOString() };
}

function emit(job, event, data) {
  const item = eventPayload(event, data);
  job.events.push(item);
  if (job.events.length > 300) job.events.shift();
  job.updatedAt = item.at;
  job.emitter.emit("event", item);
}

function safeJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function publicPathFor(job, file) {
  if (!file || typeof file !== "string") return file;
  const abs = path.isAbsolute(file) ? file : path.resolve(file);
  const outDir = path.resolve(job.outDir);
  let rel = null;

  if (abs === outDir || abs.startsWith(`${outDir}${path.sep}`)) {
    rel = path.relative(outDir, abs);
  } else {
    const marker = `${path.sep}out${path.sep}${job.id}${path.sep}`;
    const index = abs.indexOf(marker);
    if (index >= 0) rel = abs.slice(index + marker.length);
  }

  if (!rel) return file;
  return `/out/${encodeURIComponent(job.id)}/${rel.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function mapArtifactPaths(job, value) {
  if (!value || typeof value !== "object") return publicPathFor(job, value);
  if (Array.isArray(value)) return value.map((item) => mapArtifactPaths(job, item));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapArtifactPaths(job, item)]));
}

function summarize(job, state = job.state) {
  return {
    id: job.id,
    status: job.status,
    input: job.input,
    topic: state?.topic ?? job.input.topic ?? "",
    steps: state?.steps ?? {},
    warnings: state?.warnings ?? [],
    failedAt: state?.failedAt ?? null,
    error: job.error ?? null,
    artifacts: mapArtifactPaths(job, state?.artifacts ?? {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: state?.finishedAt ?? null,
  };
}

function publishState(job) {
  const statePath = path.join(job.outDir, "state.json");
  const state = safeJson(statePath);
  if (!state) {
    emit(job, "state", summarize(job));
    return;
  }

  const serialized = JSON.stringify(state);
  if (serialized === job.lastState) return;
  job.lastState = serialized;
  job.state = state;
  emit(job, "state", summarize(job, state));
}

function normalizeInput(input) {
  const topic = typeof input.topic === "string" ? input.topic.trim() : "";
  const creativePrompt = typeof input.creativePrompt === "string" ? input.creativePrompt.trim() : "";
  const characterPrompt = typeof input.characterPrompt === "string" && input.characterPrompt.trim()
    ? input.characterPrompt.trim()
    : DEFAULT_CHARACTER_PROMPT;
  const mascotPrompt = typeof input.mascotPrompt === "string" && input.mascotPrompt.trim()
    ? input.mascotPrompt.trim()
    : DEFAULT_MASCOT_PROMPT;
  const mascotImageUrl = normalizeMascotImageUrl(input.mascotImageUrl);
  const bgmPath = typeof input.bgmPath === "string" ? input.bgmPath.trim() : "";
  const modelConfig = normalizeModelConfig(input.modelConfig);

  if (topic.length > 160) throw new Error("주제는 160자 이하로 입력해주세요");
  if (creativePrompt.length > 2000) throw new Error("Creative prompt는 2000자 이하로 입력해주세요");
  if (characterPrompt.length > 1500) throw new Error("Character prompt는 1500자 이하로 입력해주세요");
  if (mascotPrompt.length > 1500) throw new Error("Mascot image prompt는 1500자 이하로 입력해주세요");
  if (bgmPath.length > 500) throw new Error("BGM 경로가 너무 깁니다");
  if ([topic, creativePrompt, characterPrompt, mascotPrompt, mascotImageUrl, bgmPath, ...Object.values(modelConfig)].some((value) => value.includes("\0"))) {
    throw new Error("입력값에 사용할 수 없는 문자가 있습니다");
  }

  return {
    topic,
    creativePrompt,
    characterPrompt,
    mascotPrompt,
    mascotImageUrl,
    bgmPath,
    modelConfig,
    mock: input.mock !== false,
  };
}

function normalizeModelConfig(input) {
  const modelConfig = input && typeof input === "object" ? input : {};
  const llmProvider = modelConfig.llmProvider === "anthropic" ? "anthropic" : "anthropic";
  const videoProvider = modelConfig.videoProvider === "gemini" ? "gemini" : "local";

  return {
    llmProvider,
    llmModel: pickModel(modelConfig.llmModel, CLAUDE_MODELS, CLAUDE_MODELS[0]),
    videoProvider,
    videoModel: pickModel(
      modelConfig.videoModel,
      videoProvider === "gemini" ? GEMINI_VIDEO_MODELS : LOCAL_VIDEO_MODELS,
      videoProvider === "gemini" ? GEMINI_VIDEO_MODELS[0] : LOCAL_VIDEO_MODELS[0],
    ),
    openaiModel: pickModel(modelConfig.openaiModel, OPENAI_MODELS, OPENAI_MODELS[0]),
  };
}

function pickModel(value, allowed, fallback) {
  const model = typeof value === "string" ? value.trim() : "";
  if (!model) return fallback;
  if (model.length > 80) throw new Error("모델 이름이 너무 깁니다");
  return allowed.includes(model) ? model : fallback;
}

function normalizeMascotImageUrl(value) {
  const url = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_MASCOT_IMAGE_URL;
  if (url.length > 500) throw new Error("마스코트 이미지 경로가 너무 깁니다");
  if (url.startsWith("/mascots/") || url.startsWith("/out/mascots/")) return url;
  throw new Error("마스코트 이미지는 기본 이미지 또는 업로드된 이미지 URL만 사용할 수 있습니다");
}

async function runJob(job) {
  const previousMock = process.env.MOCK;
  const previousLlmModel = process.env.LLM_MODEL;
  const previousVeoModel = process.env.VEO_MODEL;
  const poll = setInterval(() => publishState(job), 500);

  try {
    job.status = "running";
    emit(job, "state", summarize(job));
    if (job.input.mock) process.env.MOCK = "1";
    else delete process.env.MOCK;
    process.env.LLM_MODEL = job.input.modelConfig.llmModel;
    process.env.VEO_MODEL = job.input.modelConfig.videoModel;

    await ensureAuth();
    const state = await runWorkflow({
      topic: job.input.topic || null,
      creativePrompt: job.input.creativePrompt,
      characterPrompt: job.input.characterPrompt,
      mascotPrompt: job.input.mascotPrompt,
      mascotImageUrl: job.input.mascotImageUrl,
      bgmPath: job.input.bgmPath || null,
      modelConfig: job.input.modelConfig,
      outDir: job.outDir,
      log: (message) => {
        emit(job, "log", { message });
        publishState(job);
      },
    });

    job.status = "success";
    job.state = state;
    job.lastState = JSON.stringify(state);
    emit(job, "state", summarize(job, state));
    emit(job, "done", summarize(job, state));
  } catch (error) {
    job.status = "error";
    job.error = error?.message ?? String(error);
    publishState(job);
    emit(job, "failed", summarize(job));
  } finally {
    clearInterval(poll);
    if (previousMock === undefined) delete process.env.MOCK;
    else process.env.MOCK = previousMock;
    if (previousLlmModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = previousLlmModel;
    if (previousVeoModel === undefined) delete process.env.VEO_MODEL;
    else process.env.VEO_MODEL = previousVeoModel;
    if (store.activeRunId === job.id) store.activeRunId = null;
  }
}

export function startRun(input) {
  if (store.activeRunId) {
    throw new Error(`이미 실행 중인 작업이 있습니다: ${store.activeRunId}`);
  }

  const normalized = normalizeInput(input);
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const job = {
    id,
    input: normalized,
    outDir: path.join(OUT_ROOT, id),
    status: "queued",
    events: [],
    emitter: new EventEmitter(),
    state: null,
    lastState: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.jobs.set(id, job);
  store.activeRunId = id;
  emit(job, "state", summarize(job));
  setImmediate(() => runJob(job));
  return summarize(job);
}

export function getRun(id) {
  const job = store.jobs.get(id);
  return job ? summarize(job) : null;
}

export function getJob(id) {
  return store.jobs.get(id) ?? null;
}

export function listRuns() {
  return [...store.jobs.values()]
    .map((job) => summarize(job))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
