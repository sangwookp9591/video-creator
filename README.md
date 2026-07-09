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
- 미디어(`src/media.js`): ffmpeg-static + macOS `say`(Yuna) — 로컬에서 실제 mp4 생성

## 인증 (구독 또는 API 키)

**LLM 에이전트** — 셋 중 하나면 된다 (SDK가 자동 인식):

```bash
ant auth login                          # 1) Claude 구독 OAuth 로그인 (권장)
export ANTHROPIC_AUTH_TOKEN=sk-ant-oat01-...   # 2) OAuth 토큰 직접 지정
export ANTHROPIC_API_KEY=sk-ant-api...          # 3) API 키
```

**Veo 영상 생성** — Google AI 구독 계정의 AI Studio API 키:

```bash
export GEMINI_API_KEY=...   # 설정하면 Video Agent가 Veo 사용, 실패 시 local-ffmpeg fallback
export VEO_MODEL=veo-2.0-generate-001   # 선택 (기본값)
```

## 실행

```bash
node run.js                          # 트렌드에서 주제 자동 선정
node run.js --topic "AI 코딩 도구"   # Trend 단계 Skip
node run.js --bgm assets/bgm.mp3     # 배경음 믹스
```

산출물: `out/<runId>/` — `final.mp4`, `thumbnail.jpg`, `subs/final.{srt,ass}`,
`subs/words.json`, `seo.json`, `upload.json`(DRY_RUN 매니페스트), `state.json`

## 테스트 (API 키 불필요)

```bash
npm test   # MOCK LLM으로 TTS→렌더→자막 burn-in→합성→QA까지 실주행
```

## 미연동 (키 확보 시 확장 지점)

| 항목 | 위치 | 필요한 것 |
|---|---|---|
| Runway/Kling/LTX 영상 생성 | `src/media.js` PROVIDERS | 각 API 키 + render() 구현 (Veo는 연동됨, 최종 fallback은 local-ffmpeg) |
| YouTube 업로드 | `src/media.js` uploadAgent | OAuth 토큰 (현재 upload.json DRY_RUN) |
| youtube_trending / reddit 소스 | `src/skills.js` | API 키 / OAuth (reddit 비로그인 JSON은 403) |
