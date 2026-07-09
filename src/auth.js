// 최초 실행 인증 화면: 자격 증명이 없으면 대화형으로 받아 .env에 저장
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const ENV_FILE = path.resolve(".env");

// ponytail: dotenv 대신 4줄 파서 — KEY=VALUE 라인만 지원
export function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

function saveEnv(key, value) {
  fs.appendFileSync(ENV_FILE, `${key}=${value}\n`, { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600); // 자격 증명 파일은 소유자 전용
  process.env[key] = value;
}

function hasClaudeCreds() {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  // `ant auth login` 프로필 (SDK가 자동 인식하는 위치)
  const dir = process.env.ANTHROPIC_CONFIG_DIR || path.join(os.homedir(), ".config", "anthropic");
  try {
    return fs.readdirSync(path.join(dir, "credentials")).some((f) => f.endsWith(".json"));
  } catch {
    return false;
  }
}

export async function ensureAuth() {
  loadEnvFile();
  if (process.env.MOCK === "1") return;
  if (hasClaudeCreds() && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) return;
  if (!process.stdin.isTTY) {
    if (!hasClaudeCreds()) {
      throw new Error("Claude 자격 증명 없음 — ant auth login 또는 ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY 설정 필요");
    }
    return; // GEMINI 키는 선택 사항(local-ffmpeg fallback)
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!hasClaudeCreds()) {
      console.log("\n[최초 실행 인증] Claude 자격 증명이 없습니다.");
      console.log("  1) Claude 구독 OAuth 로그인 (ant auth login — 브라우저)");
      console.log("  2) 토큰/API 키 직접 입력 (.env에 저장)");
      const pick = (await rl.question("선택 (1/2): ")).trim();
      if (pick === "1") {
        const r = spawnSync("ant", ["auth", "login"], { stdio: "inherit" });
        if (r.error || r.status !== 0) {
          console.log("⚠ ant CLI 실행 실패 — 설치: brew install anthropics/tap/ant");
        }
      }
      if (!hasClaudeCreds()) {
        const token = (await rl.question("Claude 토큰(sk-ant-oat...) 또는 API 키(sk-ant-api...): ")).trim();
        if (!token) throw new Error("Claude 자격 증명 없이는 LLM 에이전트를 실행할 수 없습니다");
        saveEnv(token.startsWith("sk-ant-oat") ? "ANTHROPIC_AUTH_TOKEN" : "ANTHROPIC_API_KEY", token);
        console.log("✔ .env에 저장했습니다 (다음 실행부터 자동 인식)");
      }
    }
    if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
      const key = (await rl.question("\nVeo용 Gemini API 키 (구독 계정 AI Studio 키, 없으면 Enter → local-ffmpeg): ")).trim();
      if (key) {
        saveEnv("GEMINI_API_KEY", key);
        console.log("✔ .env에 저장했습니다");
      }
    }
  } finally {
    rl.close();
  }
}
