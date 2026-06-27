export type ProviderId = "fake" | "openai-compatible" | "local-openai-compatible";

export type LocalProviderPresetId = "ollama" | "lm-studio" | "custom-local";

export type LocalProviderPreset = {
  id: LocalProviderPresetId;
  label: string;
  displayName: string;
  baseURL: string;
};

export const LOCAL_PROVIDER_PRESETS: readonly LocalProviderPreset[] = [
  {
    id: "ollama",
    label: "Ollama",
    displayName: "Ollama 本地模型",
    baseURL: "http://localhost:11434/v1"
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

export type ProviderStatus = {
  providerId: ProviderId;
  displayName: string;
  model?: string;
  baseURLHost?: string;
  hasApiKey?: boolean;
  isFallback: boolean;
  reason?: "missing_api_key" | "invalid_config";
};
