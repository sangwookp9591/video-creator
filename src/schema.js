// JSON Schema 조립 헬퍼 — 구조화 출력 규약(모든 object에 additionalProperties:false)의 단일 출처
export const str = { type: "string" };
export const num = { type: "number" };
export const bool = { type: "boolean" };
export const arr = (items) => ({ type: "array", items });
export const obj = (props) => ({
  type: "object", properties: props, required: Object.keys(props), additionalProperties: false,
});
