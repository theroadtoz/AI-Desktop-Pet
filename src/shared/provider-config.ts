export type ProviderId = "fake" | "openai-compatible" | "local-openai-compatible";

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
