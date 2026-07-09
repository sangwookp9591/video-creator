"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const STEPS = [
  ["trend", "Trend"],
  ["research", "Research"],
  ["planner", "Planner"],
  ["seo", "SEO"],
  ["script", "Script"],
  ["hookqa", "Hook QA"],
  ["storyboard", "Storyboard"],
  ["prompt", "Prompt"],
  ["voice", "Voice"],
  ["video", "Video"],
  ["subtitle", "Subtitle"],
  ["compose", "Compose"],
  ["qa", "QA"],
  ["thumbnail", "Thumbnail"],
  ["upload", "Upload"],
];

const STEP_INDEX = Object.fromEntries(STEPS.map(([key], index) => [key, index]));
const DEFAULT_CHARACTER_PROMPT = "Ai-ng, a cute white AI cat mascot with cyan-blue headset, transparent smart visor with a brain icon, one eye winking, cheerful helper personality, clean Korean tech brand style";
const DEFAULT_MASCOT_PROMPT = "Ai-ng mascot: white cat, cyan and lavender AI headset, wink expression, laptop, thumbs-up pose, soft pastel tech illustration, friendly coding assistant";
const DEFAULT_MASCOT_IMAGE_URL = "/mascots/aing.png";
const LOCAL_VIDEO_MODELS = ["local-ffmpeg"];

function statusFor(step, run) {
  const item = run?.steps?.[step];
  if (item?.status) return item.status.toLowerCase();
  if (!run || !["running", "queued"].includes(run.status)) return "idle";

  const completedIndexes = Object.keys(run.steps ?? {})
    .map((key) => STEP_INDEX[key])
    .filter((index) => Number.isInteger(index));
  const nextIndex = completedIndexes.length ? Math.max(...completedIndexes) + 1 : 0;
  return STEP_INDEX[step] === nextIndex ? "running" : "idle";
}

function labelFor(status) {
  if (status === "success") return "SUCCESS";
  if (status === "running") return "RUNNING";
  if (status === "fail" || status === "error") return "FAIL";
  if (status === "skip") return "SKIP";
  return "WAIT";
}

function ArtifactButton({ href, children }) {
  if (!href) return null;
  return (
    <a className="artifactLink" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export default function Page() {
  const [topic, setTopic] = useState("");
  const [creativePrompt, setCreativePrompt] = useState("");
  const [characterPrompt, setCharacterPrompt] = useState(DEFAULT_CHARACTER_PROMPT);
  const [mascotPrompt, setMascotPrompt] = useState(DEFAULT_MASCOT_PROMPT);
  const [mascotImageUrl, setMascotImageUrl] = useState(DEFAULT_MASCOT_IMAGE_URL);
  const [bgmPath, setBgmPath] = useState("");
  const [mock, setMock] = useState(true);
  const [providerStatus, setProviderStatus] = useState(null);
  const [llmProvider, setLlmProvider] = useState("anthropic");
  const [llmModel, setLlmModel] = useState("claude-opus-4-8");
  const [videoProvider, setVideoProvider] = useState("local");
  const [videoModel, setVideoModel] = useState("local-ffmpeg");
  const [openaiModel, setOpenaiModel] = useState("gpt-5.5");
  const [isUploading, setIsUploading] = useState(false);
  const [run, setRun] = useState(null);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const sourceRef = useRef(null);

  const isRunning = run?.status === "queued" || run?.status === "running" || isStarting;
  const artifacts = run?.artifacts ?? {};
  const providers = providerStatus?.providers ?? [];
  const providerById = useMemo(() => Object.fromEntries(providers.map((provider) => [provider.id, provider])), [providers]);
  const llmModels = providerById.anthropic?.models ?? ["claude-opus-4-8"];
  const geminiVideoModels = providerById.gemini?.models ?? ["veo-2.0-generate-001"];
  const openaiModels = providerById.openai?.models ?? ["gpt-5.5"];
  const videoModels = videoProvider === "gemini" ? geminiVideoModels : LOCAL_VIDEO_MODELS;
  const completed = useMemo(() => {
    const values = Object.values(run?.steps ?? {});
    return values.filter((step) => ["SUCCESS", "SKIP"].includes(step.status)).length;
  }, [run]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/providers")
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setProviderStatus(data);
        setLlmProvider(data.defaults?.llmProvider ?? "anthropic");
        setLlmModel(data.defaults?.llmModel ?? "claude-opus-4-8");
        setVideoProvider(data.defaults?.videoProvider ?? "local");
        setVideoModel(data.defaults?.videoProvider === "gemini"
          ? data.defaults?.videoModel ?? "veo-2.0-generate-001"
          : "local-ffmpeg");
        setOpenaiModel(data.defaults?.openaiModel ?? "gpt-5.5");
      })
      .catch(() => {
        if (!cancelled) setProviderStatus({ providers: [], defaults: {} });
      });

    return () => {
      cancelled = true;
      sourceRef.current?.close();
    };
  }, []);

  function changeVideoProvider(value) {
    setVideoProvider(value);
    setVideoModel(value === "gemini" ? geminiVideoModels[0] : LOCAL_VIDEO_MODELS[0]);
  }

  function connect(runId) {
    sourceRef.current?.close();
    const source = new EventSource(`/api/runs/${runId}/events`);
    sourceRef.current = source;

    source.addEventListener("state", (event) => {
      setRun(JSON.parse(event.data));
    });
    source.addEventListener("log", (event) => {
      const data = JSON.parse(event.data);
      setLogs((items) => [...items.slice(-120), data.message]);
    });
    source.addEventListener("done", (event) => {
      setRun(JSON.parse(event.data));
      source.close();
    });
    source.addEventListener("failed", (event) => {
      const data = JSON.parse(event.data);
      setRun(data);
      setError(data.error ?? "실행 실패");
      source.close();
    });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) return;
      setError("상태 스트림 연결이 끊겼습니다");
    };
  }

  async function start(event) {
    event.preventDefault();
    setIsStarting(true);
    setError("");
    setLogs([]);
    setRun(null);

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          creativePrompt,
          characterPrompt,
          mascotPrompt,
          mascotImageUrl,
          bgmPath,
          mock,
          modelConfig: { llmProvider, llmModel, videoProvider, videoModel, openaiModel },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "실행 시작 실패");
      setRun(data.run);
      connect(data.run.id);
    } catch (startError) {
      setError(startError.message);
    } finally {
      setIsStarting(false);
    }
  }

  async function uploadMascot(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setError("");

    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/uploads/mascot", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "마스코트 업로드 실패");
      setMascotImageUrl(data.url);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  }

  function resetMascot() {
    setCharacterPrompt(DEFAULT_CHARACTER_PROMPT);
    setMascotPrompt(DEFAULT_MASCOT_PROMPT);
    setMascotImageUrl(DEFAULT_MASCOT_IMAGE_URL);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">LOCAL NEXT.JS CONTROL SURFACE</p>
          <h1>Video Creator Pipeline</h1>
        </div>
        <div className={`runBadge ${run?.status ?? "idle"}`}>
          <span />
          {run?.status ?? "idle"}
        </div>
      </header>

      <section className="workspace">
        <form className="controlPanel" onSubmit={start}>
          <div className="field">
            <label htmlFor="topic">Topic</label>
            <input
              id="topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="AI 코딩 도구"
              maxLength={160}
            />
          </div>

          <div className="field">
            <label htmlFor="creative">Creative prompt</label>
            <textarea
              id="creative"
              value={creativePrompt}
              onChange={(event) => setCreativePrompt(event.target.value)}
              placeholder="영상의 목적, 분위기, 스토리, 반드시 포함할 메시지를 입력"
              maxLength={2000}
              rows={5}
            />
          </div>

          <div className="field">
            <label htmlFor="character">Character prompt</label>
            <textarea
              id="character"
              value={characterPrompt}
              onChange={(event) => setCharacterPrompt(event.target.value)}
              placeholder="캐릭터 외형, 성격, 의상, 표정, 행동 규칙"
              maxLength={1500}
              rows={4}
            />
          </div>

          <div className="field">
            <label htmlFor="mascot">Mascot image prompt</label>
            <textarea
              id="mascot"
              value={mascotPrompt}
              onChange={(event) => setMascotPrompt(event.target.value)}
              placeholder="마스코트 이미지 생성 프롬프트: 형태, 색, 질감, 로고/소품, 금지 요소"
              maxLength={1500}
              rows={4}
            />
          </div>

          <div className="mascotPicker">
            <div className="mascotPreview">
              <img src={mascotImageUrl} alt="Ai-ng mascot" />
            </div>
            <div className="mascotActions">
              <label className="fileButton" htmlFor="mascotImage">
                {isUploading ? "Uploading" : "Upload mascot"}
              </label>
              <input
                id="mascotImage"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={uploadMascot}
                disabled={isUploading || isRunning}
              />
              <button type="button" className="ghostButton" onClick={resetMascot} disabled={isUploading || isRunning}>
                Reset Ai-ng
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="bgm">BGM path</label>
            <input
              id="bgm"
              value={bgmPath}
              onChange={(event) => setBgmPath(event.target.value)}
              placeholder="assets/bgm.mp3"
            />
          </div>

          <label className="toggle">
            <input type="checkbox" checked={mock} onChange={(event) => setMock(event.target.checked)} />
            <span>Mock LLM</span>
          </label>

          <div className="authHelp">
            <strong>Actual mode setup</strong>
            <p>Claude는 `ant auth login`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY` 중 하나가 필요합니다. Gemini OAuth 계열은 Vertex AI ADC, OpenAI API는 API key 또는 Workload Identity Federation bearer credential 방식입니다.</p>
            <a href="https://platform.claude.com/" target="_blank" rel="noreferrer">Claude Console</a>
            <a href="https://platform.claude.com/docs/en/get-started" target="_blank" rel="noreferrer">API key docs</a>
          </div>

          <section className="aiConsole" aria-label="Connected AI">
            <div className="sectionHead">
              <h2>Connected AI</h2>
              <span>{providers.filter((provider) => provider.connected).length}/{providers.length || 3}</span>
            </div>

            <div className="providerList">
              {providers.length ? providers.map((provider) => (
                <div className="providerRow" key={provider.id}>
                  <div>
                    <strong>{provider.label}</strong>
                    <small>{provider.auth}</small>
                  </div>
                  <span className={`connectionDot ${provider.connected ? "on" : "off"}`}>
                    {provider.connected ? (provider.supportsRun ? "run" : "view") : "off"}
                  </span>
                  {provider.note ? <p>{provider.note}</p> : null}
                </div>
              )) : (
                <div className="providerRow">
                  <div>
                    <strong>Loading providers</strong>
                    <small>checking local env</small>
                  </div>
                </div>
              )}
            </div>

            <div className="modelGrid">
              <div className="field">
                <label htmlFor="llmModel">Script LLM</label>
                <select
                  id="llmModel"
                  value={llmModel}
                  onChange={(event) => setLlmModel(event.target.value)}
                  disabled={isRunning}
                >
                  {llmModels.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </div>

              <div className="field">
                <label htmlFor="videoProvider">Video provider</label>
                <select
                  id="videoProvider"
                  value={videoProvider}
                  onChange={(event) => changeVideoProvider(event.target.value)}
                  disabled={isRunning}
                >
                  <option value="local">Local ffmpeg</option>
                  <option value="gemini">Gemini / Veo</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="videoModel">Video model</label>
                <select
                  id="videoModel"
                  value={videoModel}
                  onChange={(event) => setVideoModel(event.target.value)}
                  disabled={isRunning}
                >
                  {videoModels.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </div>

              <div className="field">
                <label htmlFor="openaiModel">OpenAI model</label>
                <select
                  id="openaiModel"
                  value={openaiModel}
                  onChange={(event) => setOpenaiModel(event.target.value)}
                  disabled={isRunning}
                >
                  {openaiModels.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </div>
            </div>
          </section>

          <button className="runButton" type="submit" disabled={isRunning}>
            {isRunning ? "Running" : "Run Pipeline"}
          </button>

          {error ? <p className="errorText">{error}</p> : null}

          <dl className="runMeta">
            <div>
              <dt>Run ID</dt>
              <dd>{run?.id ?? "-"}</dd>
            </div>
            <div>
              <dt>Topic</dt>
              <dd>{run?.topic || "-"}</dd>
            </div>
            <div>
              <dt>Prompt</dt>
              <dd>{run?.input?.creativePrompt ? "custom" : "-"}</dd>
            </div>
            <div>
              <dt>Character</dt>
              <dd>{run?.input?.characterPrompt || run?.input?.mascotPrompt ? "custom" : "-"}</dd>
            </div>
            <div>
              <dt>Mascot image</dt>
              <dd>{run?.input?.mascotImageUrl ?? mascotImageUrl}</dd>
            </div>
            <div>
              <dt>LLM model</dt>
              <dd>{run?.input?.modelConfig?.llmModel ?? llmModel}</dd>
            </div>
            <div>
              <dt>Video model</dt>
              <dd>{run?.input?.modelConfig?.videoModel ?? videoModel}</dd>
            </div>
            <div>
              <dt>Progress</dt>
              <dd>{completed}/{STEPS.length}</dd>
            </div>
          </dl>
        </form>

        <section className="pipelinePanel">
          <div className="panelHead">
            <h2>Pipeline</h2>
            <span>{completed}/{STEPS.length}</span>
          </div>
          <ol className="steps">
            {STEPS.map(([key, label]) => {
              const status = statusFor(key, run);
              const reason = run?.steps?.[key]?.reason;
              return (
                <li className={`step ${status}`} key={key}>
                  <span className="stepIndex">{String(STEP_INDEX[key] + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{label}</strong>
                    <small>{reason ?? labelFor(status)}</small>
                  </div>
                  <span className="statusPill">{labelFor(status)}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="resultPanel">
          <div className="panelHead">
            <h2>Output</h2>
            <span>{run?.finishedAt ? "ready" : "waiting"}</span>
          </div>

          <div className="previewStage">
            {artifacts.final ? (
              <video src={artifacts.final} controls playsInline />
            ) : (
              <div className="emptyPreview">No video yet</div>
            )}
          </div>

          <div className="artifactGrid">
            <ArtifactButton href={artifacts.final}>Open video</ArtifactButton>
            <ArtifactButton href={artifacts.thumbnail}>Open thumbnail</ArtifactButton>
            <ArtifactButton href={artifacts.upload}>Upload manifest</ArtifactButton>
            <ArtifactButton href={artifacts.subtitles?.srt}>SRT</ArtifactButton>
            <ArtifactButton href={artifacts.subtitles?.ass}>ASS</ArtifactButton>
            <ArtifactButton href={artifacts.subtitles?.words}>Words</ArtifactButton>
          </div>

          <div className="logBox">
            {logs.length ? logs.map((item, index) => <p key={`${item}-${index}`}>{item}</p>) : <p>Logs will appear here.</p>}
          </div>
        </section>
      </section>
    </main>
  );
}
