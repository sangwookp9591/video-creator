// LLM 기반 에이전트 정의: 프롬프트 + 출력 스키마 + mock(테스트용)
import { gatherTrendSources, research as researchSkill } from "./skills.js";
import { str, num, bool, arr, obj } from "./schema.js";

export const trendAgent = {
  name: "Trend Agent",
  prompt: `Mission: 가장 가치 있는 Topic을 찾는다.
입력의 sources(hackernews/geeknews/google_trends/reddit)를 근거로만 판단한다.
Process: 중복 제거 → Score 계산 → 상위 Topic 선택.
Scoring: 검색량 + 조회수/댓글 증가율 + 신선도 + 기술 영향도 + CTR 예상.
Output: 한국 개발자/테크 시청자 대상 Shorts에 적합한 Top 10 Topic.
모든 source가 비어 있으면 FAIL로 응답한다.`,
  outputSchema: obj({
    topics: arr(obj({ title: str, source: str, reason: str, score: num })),
  }),
  skills: () => gatherTrendSources(),
  mock: () => ({
    status: "SUCCESS", reason: "mock", next: "research",
    output: { topics: [{ title: "AI 코딩 도구의 부상", source: "hackernews", reason: "mock", score: 95 }] },
  }),
};

export const researchAgent = {
  name: "Research Agent",
  prompt: `Mission: Topic을 조사한다. 절대로 대본을 작성하지 않는다.
입력의 skill 결과(web_search, wikipedia)에 있는 내용만 사실로 기록한다.
확인 불가한 것은 unknown에 넣는다.`,
  outputSchema: obj({
    facts: arr(str), statistics: arr(str), references: arr(str),
    quotes: arr(str), controversy: str, timeline: arr(str), unknown: arr(str),
  }),
  skills: (input) => researchSkill(input.topic.title),
  mock: () => ({
    status: "SUCCESS", reason: "mock", next: "planner",
    output: {
      facts: ["개발자 다수가 AI 코딩 도구를 사용한다"], statistics: ["설문 응답자 76%가 사용 중"],
      references: ["https://example.com"], quotes: [], controversy: "일자리 대체 논쟁",
      timeline: ["2021 Copilot 출시"], unknown: ["정확한 생산성 향상 수치"],
    },
  }),
};

export const plannerAgent = {
  name: "Topic Planner Agent",
  prompt: `Mission: Research 결과를 Shorts 주제로 변환한다.
Output: Title, Hook, Target(시청자), Length(초, 20~45), Core Message, CTA.`,
  outputSchema: obj({
    title: str, hook: str, target: str, length_sec: num, core_message: str, cta: str,
  }),
  mock: () => ({
    status: "SUCCESS", reason: "mock", next: "script",
    output: {
      title: "개발자 76%가 이미 쓰는 도구", hook: "개발자 76%가 이미 쓰고 있습니다",
      target: "주니어 개발자", length_sec: 20, core_message: "AI 도구는 선택이 아니라 기본기",
      cta: "구독하고 다음 편 확인",
    },
  }),
};

export const scriptAgent = {
  name: "Script Agent",
  prompt: `Mission: 20~45초 Shorts 대본 생성.
Rules: 첫 3초 Hook / 5초마다 새로운 정보 / 한 문장은 15자 내외 / 어려운 단어 금지.
Scene별로 dialogue(화면 자막용), narration(TTS 낭독용), start_sec, end_sec를 만든다.
qa_feedback이 있으면 Hook을 그 피드백대로 다시 쓴다.`,
  outputSchema: obj({
    scenes: arr(obj({ id: num, dialogue: str, narration: str, start_sec: num, end_sec: num })),
  }),
  mock: () => ({
    status: "SUCCESS", reason: "mock", next: "hookqa",
    output: {
      scenes: [
        { id: 1, dialogue: "개발자 76%가 씁니다", narration: "개발자 76%가 이미 쓰고 있습니다", start_sec: 0, end_sec: 3 },
        { id: 2, dialogue: "AI 코딩 도구", narration: "바로 AI 코딩 도구입니다", start_sec: 3, end_sec: 7 },
        { id: 3, dialogue: "코드를 대신 짜준다", narration: "반복 작업을 대신 처리해 줍니다", start_sec: 7, end_sec: 12 },
        { id: 4, dialogue: "구독하고 다음 편!", narration: "더 알고 싶다면 구독하세요", start_sec: 12, end_sec: 16 },
      ],
    },
  }),
};

export const hookQaAgent = {
  name: "Hook QA Agent",
  prompt: `Mission: 첫 3초(첫 Scene)만 평가한다.
Checklist: 궁금증 유발 / 충격 / 숫자 / 반전 / 이득 / 손실회피 / CTR 예상.
기준 미달이면 pass=false와 개선 방향 feedback을 준다.`,
  outputSchema: obj({ pass: bool, score: num, feedback: str }),
  mock: () => ({
    status: "SUCCESS", reason: "mock", next: "storyboard",
    output: { pass: true, score: 88, feedback: "숫자 훅이 명확함" },
  }),
};

export const storyboardAgent = {
  name: "Storyboard Agent",
  prompt: `Mission: Script를 Scene으로 분리한다. 입력 scenes와 1:1 대응해야 한다.
각 Scene에 camera, duration_sec, emotion, transition, visual_goal을 정의한다.`,
  outputSchema: obj({
    scenes: arr(obj({
      id: num, camera: str, duration_sec: num, emotion: str, transition: str, visual_goal: str,
    })),
  }),
  mock: (input) => ({
    status: "SUCCESS", reason: "mock", next: "prompt",
    output: {
      scenes: input.scenes.map((s) => ({
        id: s.id, camera: "close-up", duration_sec: s.end_sec - s.start_sec,
        emotion: "호기심", transition: "cut", visual_goal: s.dialogue,
      })),
    },
  }),
};

export const promptAgent = {
  name: "Prompt Agent",
  prompt: `Mission: Scene마다 영상 생성용 Prompt를 만든다. 입력 scenes와 1:1 대응해야 한다.
image_prompt, video_prompt, negative_prompt, camera_motion, lighting, style을 영어로 작성한다.`,
  outputSchema: obj({
    scenes: arr(obj({
      id: num, image_prompt: str, video_prompt: str, negative_prompt: str,
      camera_motion: str, lighting: str, style: str,
    })),
  }),
  mock: (input) => ({
    status: "SUCCESS", reason: "mock", next: "video",
    output: {
      scenes: input.scenes.map((s) => ({
        id: s.id, image_prompt: `tech scene: ${s.visual_goal}`, video_prompt: "slow push-in",
        negative_prompt: "text, watermark", camera_motion: "push-in", lighting: "neon", style: "cinematic",
      })),
    },
  }),
};

export const seoAgent = {
  name: "SEO Agent",
  prompt: `Mission: 업로드용 SEO 메타데이터 생성.
Output: Title, Description, Hashtag, Keywords, Category, Language, Tags. 한국어 기준.`,
  outputSchema: obj({
    title: str, description: str, hashtags: arr(str), keywords: arr(str),
    category: str, language: str, tags: arr(str),
  }),
  mock: () => ({
    status: "SUCCESS", reason: "mock", next: "upload",
    output: {
      title: "개발자 76%가 이미 쓰는 도구 #shorts", description: "AI 코딩 도구 이야기",
      hashtags: ["#shorts", "#AI", "#개발자"], keywords: ["AI 코딩", "개발 도구"],
      category: "Science & Technology", language: "ko", tags: ["ai", "coding"],
    },
  }),
};
