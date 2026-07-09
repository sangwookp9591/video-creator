import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvFile } from "./auth.js";

export const CLAUDE_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
];

export const GEMINI_VIDEO_MODELS = [
  "veo-2.0-generate-001",
  "veo-3.0-generate-preview",
];

export const OPENAI_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.2",
];

export const LOCAL_VIDEO_MODELS = [
  "local-ffmpeg",
];

function hasAnthropicCliLogin() {
  const dir = process.env.ANTHROPIC_CONFIG_DIR || path.join(os.homedir(), ".config", "anthropic");
  try {
    return fs.readdirSync(path.join(dir, "credentials")).some((file) => file.endsWith(".json"));
  } catch {
    return false;
  }
}

export function hasGoogleAdc() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return true;
  }
  return fs.existsSync(path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json"));
}

export function hasGeminiApiKey() {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

export function hasVertexAiOAuth() {
  return process.env.GOOGLE_GENAI_USE_VERTEXAI === "true"
    && !!process.env.GOOGLE_CLOUD_PROJECT
    && !!process.env.GOOGLE_CLOUD_LOCATION
    && hasGoogleAdc();
}

export function getProviderStatus() {
  loadEnvFile();

  const claudeApiKey = !!process.env.ANTHROPIC_API_KEY;
  const claudeOAuthToken = !!process.env.ANTHROPIC_AUTH_TOKEN;
  const claudeCliLogin = hasAnthropicCliLogin();
  const geminiApiKey = hasGeminiApiKey();
  const vertexConfigured = process.env.GOOGLE_GENAI_USE_VERTEXAI === "true"
    && !!process.env.GOOGLE_CLOUD_PROJECT
    && !!process.env.GOOGLE_CLOUD_LOCATION;
  const vertexOAuth = hasVertexAiOAuth();
  const openaiApiKey = !!process.env.OPENAI_API_KEY;
  const openaiAccessToken = !!process.env.OPENAI_ACCESS_TOKEN;
  const defaultVideoProvider = geminiApiKey || vertexOAuth ? "gemini" : "local";

  return {
    defaults: {
      llmProvider: "anthropic",
      llmModel: process.env.LLM_MODEL || CLAUDE_MODELS[0],
      videoProvider: defaultVideoProvider,
      videoModel: defaultVideoProvider === "gemini" ? process.env.VEO_MODEL || GEMINI_VIDEO_MODELS[0] : LOCAL_VIDEO_MODELS[0],
      openaiModel: process.env.OPENAI_MODEL || OPENAI_MODELS[0],
    },
    providers: [
      {
        id: "anthropic",
        label: "Claude",
        connected: claudeApiKey || claudeOAuthToken || claudeCliLogin,
        auth: claudeOAuthToken ? "OAuth token" : claudeCliLogin ? "ant auth login" : claudeApiKey ? "API key" : "not connected",
        supportsRun: true,
        supportsOAuth: true,
        env: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
        login: "ant auth login",
        models: CLAUDE_MODELS,
      },
      {
        id: "gemini",
        label: "Gemini / Vertex AI",
        connected: geminiApiKey || vertexOAuth,
        auth: vertexOAuth
          ? "Vertex AI OAuth ADC"
          : geminiApiKey
            ? "Gemini API key"
            : vertexConfigured
              ? "Vertex AI configured, ADC missing"
              : "not connected",
        supportsRun: true,
        supportsOAuth: true,
        note: "Gemini API key 또는 Vertex AI Application Default Credentials(gcloud auth application-default login)를 지원합니다.",
        env: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
        login: "gcloud auth application-default login",
        models: GEMINI_VIDEO_MODELS,
      },
      {
        id: "openai",
        label: "OpenAI",
        connected: openaiApiKey || openaiAccessToken,
        auth: openaiAccessToken ? "short-lived bearer access token" : openaiApiKey ? "API key" : "not connected",
        supportsRun: false,
        supportsOAuth: false,
        note: "OpenAI API는 일반 사용자 OAuth 로그인 대신 API key 또는 Workload Identity Federation으로 만든 bearer credential을 사용합니다. 현재 이 앱에서는 상태/모델 표시만 합니다.",
        env: ["OPENAI_API_KEY", "OPENAI_ACCESS_TOKEN"],
        login: "OpenAI Platform API key or Workload Identity Federation",
        models: OPENAI_MODELS,
      },
    ],
  };
}
