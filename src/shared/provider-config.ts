export type ProviderId = "fake" | "openai-compatible" | "local-openai-compatible";

export type LocalProviderPresetId = "ollama" | "lm-studio" | "custom-local";

export type LocalProviderPreset = {
  id: LocalProviderPresetId;
  label: string;
  displayName: string;
  baseURL: string;
};

export type OpenAICompatibleConfig = {
  providerId: "openai-compatible";
  displayName: string;
  baseURL: string;
  model: string;
  apiKeyRef: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
};

export type LocalOpenAICompatibleConfig = {
  providerId: "local-openai-compatible";
  displayName: string;
  baseURL: string;
  model: string;
  localPresetId?: LocalProviderPresetId;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
};

export type FakeProviderConfig = {
  providerId: "fake";
  displayName: string;
};

export type ProviderConfig = FakeProviderConfig | OpenAICompatibleConfig | LocalOpenAICompatibleConfig;

export const RECOMMENDED_LOCAL_PROVIDER_CONFIG = {
  providerId: "local-openai-compatible",
  displayName: "Ollama 本地模型",
  baseURL: "http://localhost:11434/v1",
  model: "qwen3.5:2b-q4_K_M",
  localPresetId: "ollama",
  temperature: 0.7,
  maxTokens: 240,
  timeoutMs: 60_000
} as const satisfies LocalOpenAICompatibleConfig;

export const FAKE_PROVIDER_CONFIG: FakeProviderConfig = {
  providerId: "fake",
  displayName: "Fake Provider"
};

export const LOCAL_PROVIDER_PRESETS: readonly LocalProviderPreset[] = [
  {
    id: "ollama",
    label: "Ollama（推荐）",
    displayName: RECOMMENDED_LOCAL_PROVIDER_CONFIG.displayName,
    baseURL: RECOMMENDED_LOCAL_PROVIDER_CONFIG.baseURL
  },
  {
    id: "lm-studio",
    label: "LM Studio",
    displayName: "LM Studio 本地模型",
    baseURL: "http://localhost:1234/v1"
  },
  {
    id: "custom-local",
    label: "自定义本地端点",
    displayName: "本地 OpenAI-compatible",
    baseURL: ""
  }
] as const;

export type ProviderStatus = {
  providerId: ProviderId;
  displayName: string;
  model?: string;
  baseURLHost?: string;
  hasApiKey?: boolean;
  isFallback: boolean;
  reason?: "missing_api_key" | "invalid_config";
};
