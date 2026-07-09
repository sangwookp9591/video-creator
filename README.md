# video-creator

YouTube Shorts 자동 생성 멀티 에이전트 파이프라인.

```
Trend → Research → Planner → Script ↔ HookQA → Storyboard → Prompt
→ Voice(TTS) → Video → Subtitle → Compose → QA → Thumbnail → SEO → Upload
```

- **Director**(`src/director.js`)가 호출/Retry/Branch/Skip/중단만 결정하고 매 step마다 `state.json` 저장
- LLM 에이전트(`src/agents.js`)는 공통 Agent Loop(`src/llm.js`)로 실행 —
  `{status, reason, output, next}` JSON 봉투 + json_schema 구조화 출력 (기본 모델 `claude-opus-4-8`)
- Skill(`src/skills.js`): HackerNews / GeekNews / Google Trends(KR) — 키 없이 동작
- 미디어(`src/media.js`): ffmpeg-static + TTS fallback(macOS `say` → Linux `espeak-ng` → 저음량 기준음) + OS별 폰트 fallback — 로컬/Docker에서 실제 mp4 생성

## 인증과 AI 연결

웹 UI의 **Connected AI** 영역에서 현재 연결 상태와 선택 가능한 모델을 확인한다.

| 공급자 | 현재 역할 | 인증 방식 | 실행 연결 |
|---|---|---|---|
| Claude | Script/Research/Planner 등 LLM 에이전트 | `ant auth login`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY` | 연결됨 |
| Gemini / Vertex AI | Veo 영상 생성 | `GEMINI_API_KEY`/`GOOGLE_API_KEY` 또는 Vertex AI ADC OAuth | 연결됨 |
| OpenAI | 연결 상태/모델 표시 | `OPENAI_API_KEY` 또는 Workload Identity Federation bearer credential | 상태 표시만 |

### Claude

LLM 에이전트는 셋 중 하나면 된다. SDK가 자동 인식한다:

```bash
ant auth login                          # 1) Claude 구독 OAuth 로그인 (권장)
export ANTHROPIC_AUTH_TOKEN=sk-ant-oat01-...   # 2) OAuth 토큰 직접 지정
export ANTHROPIC_API_KEY=sk-ant-api...          # 3) API 키
```

API 키 발급:

1. [Claude Console](https://platform.claude.com/)에 로그인
2. API Keys 메뉴에서 새 키 생성
3. 프로젝트 루트의 `.env`에 저장

```bash
ANTHROPIC_API_KEY=sk-ant-api...
```

웹 UI에서 실제 LLM 실행을 하려면 `.env` 저장 후 서버를 다시 켜고 `Mock LLM` 체크를 끈다.

OAuth를 쓰려면 둘 중 하나를 사용한다:

```bash
ant auth login
# 또는
ANTHROPIC_AUTH_TOKEN=sk-ant-oat...
```

### Gemini / Veo

Google AI Studio API 키를 쓰는 방식:

```bash
export GEMINI_API_KEY=...   # 설정하면 Video Agent가 Veo 사용, 실패 시 local-ffmpeg fallback
export VEO_MODEL=veo-2.0-generate-001   # 선택 (기본값)
```

Vertex AI OAuth/Application Default Credentials를 쓰는 방식:

```bash
gcloud auth application-default login
export GOOGLE_GENAI_USE_VERTEXAI=true
export GOOGLE_CLOUD_PROJECT=your-gcp-project
export GOOGLE_CLOUD_LOCATION=us-central1
export VEO_MODEL=veo-2.0-generate-001
```

Gemini는 UI에서 `Local ffmpeg` 또는 `Gemini / Veo` 공급자를 고르고, Veo 모델을 선택한다.
Gemini 인증이 없거나 호출 실패 시에는 비용이 들지 않는 local-ffmpeg fallback으로 영상이 생성된다.

### OpenAI

OpenAI API는 일반 사용자 OAuth 로그인 버튼 방식이 아니라, 서버에서 보관하는 API key 또는 Workload Identity Federation으로 발급된 짧은 bearer credential을 사용한다. 이 앱의 현재 UI는 OpenAI 연결 상태와 최신 모델 선택값을 보여주지만, 실제 LLM 실행 공급자는 아직 Claude로 고정되어 있다.

## 실행

```bash
npm run dev                         # Next.js 웹 UI 실행
node run.js                          # 트렌드에서 주제 자동 선정
node run.js --topic "AI 코딩 도구"   # Trend 단계 Skip
node run.js --bgm assets/bgm.mp3     # 배경음 믹스
```

웹 UI: `http://localhost:3005` — 주제/상세 프롬프트/캐릭터 프롬프트/마스코트 이미지 프롬프트 입력,
마스코트 업로드, 연결된 AI 상태, 모델 선택, mock/실제 실행 선택, Pipeline 단계별 상태, 로그,
결과 영상/썸네일 링크를 한 화면에서 확인.

- `Creative prompt`: 영상 목적, 톤, 스토리, 반드시 포함할 메시지
- `Character prompt`: 캐릭터 외형, 성격, 의상, 표정, 행동 규칙
- `Mascot image prompt`: 마스코트 이미지 생성용 형태, 색, 질감, 소품, 금지 요소
- 기본 마스코트는 `public/mascots/aing.png`의 Ai-ng(아잉) 캐릭터이며, UI에서 PNG/JPG/WEBP 이미지를 업로드해 교체 가능
- `Connected AI`: Claude/Gemini/OpenAI 연결 상태 확인, Claude LLM 모델 선택, Gemini/Local 영상 공급자와 모델 선택

산출물: `out/<runId>/` — `final.mp4`, `thumbnail.jpg`, `subs/final.{srt,ass}`,
`subs/words.json`, `seo.json`, `upload.json`(DRY_RUN 매니페스트), `state.json`

## Docker 실행

API 키 없이 컨테이너 빌드부터 영상 생성까지 한 번에 검증:

```bash
npm run docker:run
```

Docker에서 웹 UI를 띄우려면:

```bash
npm run docker:web
```

동일 이미지로 실제 주제를 실행하려면 `.env` 또는 shell 환경변수에 `ANTHROPIC_API_KEY`
또는 `ANTHROPIC_AUTH_TOKEN`을 설정한 뒤:

```bash
docker compose run --rm video-creator node run.js --topic "AI 코딩 도구"
```

Docker 이미지에는 Linux 실행에 필요한 `ffmpeg/ffprobe`, `espeak-ng`, `fonts-nanum`이 포함된다.
생성물은 호스트의 `out/`에 저장된다.

## 테스트 (API 키 불필요)

```bash
npm test   # MOCK LLM으로 TTS→렌더→자막 burn-in→합성→QA까지 실주행
```

### 브라우저 산출물 검증

생성된 영상·썸네일·자막·메타데이터를 브라우저에서 눈으로 확인:

```bash
node src/preview.js out/<runId>   # preview.html + subs/final.vtt 생성
agent-browser --executable-path "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --allow-file-access open "file://$PWD/out/<runId>/preview.html"
agent-browser screenshot --full shot.png
```

preview.html: 영상(번인 자막 + VTT 트랙), 썸네일, Plan/SEO/QA 표를 한 화면에 표시.

## 미연동 (키 확보 시 확장 지점)

| 항목 | 위치 | 필요한 것 |
|---|---|---|
| Runway/Kling/LTX 영상 생성 | `src/media.js` PROVIDERS | 각 API 키 + render() 구현 (Veo는 연동됨, 최종 fallback은 local-ffmpeg) |
| YouTube 업로드 | `src/media.js` uploadAgent | OAuth 토큰 (현재 upload.json DRY_RUN) |
| youtube_trending / reddit 소스 | `src/skills.js` | API 키 / OAuth (reddit 비로그인 JSON은 403) |
