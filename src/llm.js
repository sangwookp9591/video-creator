// 공통 Agent Loop 실행기 — 모든 LLM 에이전트는 {status, reason, output, next} 봉투로 응답
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.LLM_MODEL || "claude-opus-4-8";
export const MOCK = process.env.MOCK === "1";

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const COMMON_LOOP = `당신은 하나의 AI Agent이다.
당신의 목표는 "현재 단계의 산출물"을 만드는 것이다. 절대로 다음 단계의 작업을 수행하지 않는다.

매 반복마다: 1. 현재 입력 분석 2. 필요한 정보 확인 3. 부족하면 입력에 포함된 Skill 결과 활용
4. 충분하면 현재 단계 결과 생성 5. Self Review 수행 6. 품질 미달이면 다시 수행 7. 통과하면 종료.

절대로 추측하지 않는다. LLM의 기억보다 입력에 포함된 Skill의 결과를 신뢰한다.
입력 데이터가 결과를 만들기에 부족하면 status를 "FAIL"로, 재시도로 해결 가능하면 "RETRY"로 응답한다.
모든 결과는 재현 가능해야 하며 출력은 항상 구조화한다.
반드시 {"status":"SUCCESS|RETRY|FAIL","reason":"...","output":{...},"next":"..."} JSON으로만 응답한다.`;

function envelopeSchema(outputSchema) {
  return {
    type: "object",
    properties: {
      status: { type: "string", enum: ["SUCCESS", "RETRY", "FAIL"] },
      reason: { type: "string" },
      output: outputSchema,
      next: { type: "string" },
    },
    required: ["status", "reason", "output", "next"],
    additionalProperties: false,
  };
}

async function callClaude(agent, input) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: `${COMMON_LOOP}\n\n[현재 Agent: ${agent.name}]\n${agent.prompt}`,
    messages: [{ role: "user", content: JSON.stringify(input) }],
    output_config: { format: { type: "json_schema", schema: envelopeSchema(agent.outputSchema) } },
  });
  if (response.stop_reason === "refusal") {
    return { status: "FAIL", reason: "모델이 요청을 거부했습니다", output: {}, next: "" };
  }
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  return JSON.parse(text);
}

// 공통 Agent Loop: 생성 → Self Review(프롬프트 내장) → RETRY면 재시도 → FAIL/성공 반환
export async function runAgent(agent, input, { maxRetries = 2 } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = MOCK ? agent.mock(input) : await callClaude(agent, input);
    if (last.status === "SUCCESS") return { ...last, attempts: attempt + 1 };
    if (last.status === "FAIL") return { ...last, attempts: attempt + 1 };
    input = { ...input, retry_feedback: last.reason }; // RETRY → 사유를 넣고 재시도
  }
  return { ...last, status: "FAIL", attempts: maxRetries + 1 };
}
