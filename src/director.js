// Director Agent: 콘텐츠를 생성하지 않는다. 호출/Retry/Branch/Skip/종료만 결정하고 State를 저장한다.
import fs from "node:fs";
import path from "node:path";
import { runAgent } from "./llm.js";
import * as A from "./agents.js";
import * as M from "./media.js";

export async function runWorkflow({ topic = null, outDir, bgmPath = null, log = console.log }) {
  fs.mkdirSync(outDir, { recursive: true });
  const state = {
    runId: path.basename(outDir), topic, startedAt: new Date().toISOString(),
    steps: {}, warnings: [],
  };
  const save = () => fs.writeFileSync(path.join(outDir, "state.json"), JSON.stringify(state, null, 2));

  // 한 번에 하나의 Agent만 실행. FAIL이면 Workflow 중단.
  async function step(name, fn) {
    log(`▶ ${name}`);
    const res = await fn();
    state.steps[name] = { status: res.status, reason: res.reason, attempts: res.attempts ?? 1 };
    save();
    if (res.status !== "SUCCESS") {
      state.failedAt = name;
      save();
      throw new Error(`[${name}] ${res.reason}`);
    }
    return res.output;
  }

  const artifact = (name, data) =>
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 2));

  // 1. Trend (topic이 주어지면 Skip — Branch 결정)
  let chosenTopic = topic ? { title: topic, source: "user", reason: "사용자 지정", score: 100 } : null;
  if (!chosenTopic) {
    const { topics } = await step("trend", async () =>
      runAgent(A.trendAgent, { sources: await A.trendAgent.skills() }));
    artifact("topics.json", topics);
    chosenTopic = topics[0];
  } else {
    state.steps.trend = { status: "SKIP", reason: "사용자 topic 지정" };
    save();
  }
  state.topic = chosenTopic.title;

  // 2. Research
  const researchOut = await step("research", async () =>
    runAgent(A.researchAgent, {
      topic: chosenTopic,
      skill: await A.researchAgent.skills({ topic: chosenTopic }),
    }));
  artifact("research.json", researchOut);

  // 3. Topic Planner
  const plan = await step("planner", () =>
    runAgent(A.plannerAgent, { topic: chosenTopic, research: researchOut }));
  artifact("plan.json", plan);

  // 14를 미리 발사: SEO는 planner 산출물만 필요 → 미디어 단계와 겹치게 실행, upload 직전 join
  const seoPromise = step("seo", () =>
    runAgent(A.seoAgent, { plan, topic: chosenTopic, research: researchOut })).catch((e) => e);

  // 4~5. Script ↔ Hook QA (Fail이면 Hook 재작성, 최대 2회 — Branch)
  let script, hookFeedback = null;
  for (let round = 0; round < 3; round++) {
    script = await step(`script${round ? `_retry${round}` : ""}`, () =>
      runAgent(A.scriptAgent, { plan, research: researchOut, qa_feedback: hookFeedback }));
    const hq = await step(`hookqa${round ? `_retry${round}` : ""}`, () =>
      runAgent(A.hookQaAgent, { hook_scene: script.scenes[0], plan }));
    if (hq.pass) { state.hookScore = hq.score; break; }
    hookFeedback = hq.feedback;
    if (round === 2) state.warnings.push(`Hook QA 미통과 상태로 진행: ${hq.feedback}`);
  }
  artifact("script.json", script);

  // 6. Storyboard
  const storyboard = await step("storyboard", () =>
    runAgent(A.storyboardAgent, { scenes: script.scenes, plan }));
  artifact("storyboard.json", storyboard);

  // 7. Prompt
  const prompts = await step("prompt", () =>
    runAgent(A.promptAgent, { scenes: storyboard.scenes, plan }));
  artifact("prompts.json", prompts);

  // 9. Voice — 먼저 생성해 실제 길이를 확정하고, scene 길이를 비례 보정
  const narration = script.scenes.map((s) => s.narration).join(" ");
  const scriptDur = script.scenes.at(-1).end_sec;
  const voice = await step("voice", () =>
    M.voiceAgent({ narration, estimatedDur: scriptDur, outDir }));
  const scale = voice.duration / scriptDur;

  const scenes = script.scenes.map((s, i) => ({
    ...s, ...storyboard.scenes[i], ...prompts.scenes[i],
    start: s.start_sec * scale, end: s.end_sec * scale,
    duration_sec: (s.end_sec - s.start_sec) * scale,
  }));

  // 8. Video (Provider 체인, 실패 시 다음 Provider)
  const videos = await step("video", () => M.videoAgent({ scenes, outDir }));

  // 10. Subtitle
  const cues = scenes.map((s) => ({ start: s.start, end: s.end, text: s.dialogue, narration: s.narration }));
  const subs = await step("subtitle", () => M.subtitleAgent({ cues, outDir }));

  // 11~12. Compose → QA (미통과 시 1회 재합성 — Retry 결정)
  let final, qa;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = attempt ? "_retry1" : "";
    final = await step(`compose${suffix}`, () =>
      M.composeAgent({
        sceneFiles: videos.videos.map((v) => v.video_url),
        voicePath: voice.path, cues, outDir, bgmPath,
      }));
    qa = await step(`qa${suffix}`, () =>
      M.qaAgent({ finalPath: final.final, expectedDur: voice.duration }));
    if (qa.pass) break;
    if (attempt === 1) {
      state.failedAt = "qa";
      save();
      throw new Error(`[qa] 재시도 후에도 미통과: ${qa.issues.join("; ")}`);
    }
  }
  artifact("qa.json", qa);

  // 13. Thumbnail
  const thumb = await step("thumbnail", () =>
    M.thumbnailAgent({ finalPath: final.final, title: plan.title, outDir }));

  // 14. SEO join (planner 직후 발사해 둔 것)
  const seo = await seoPromise;
  if (seo instanceof Error) throw seo;
  artifact("seo.json", seo);

  // 15. Upload
  const upload = await step("upload", () =>
    M.uploadAgent({ seo, finalPath: final.final, thumbPath: thumb.path, outDir }));

  state.finishedAt = new Date().toISOString();
  state.artifacts = {
    final: final.final, thumbnail: thumb.path, subtitles: subs,
    upload: upload.manifest, voice: voice.path,
  };
  save();
  return state;
}
