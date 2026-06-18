export type ProviderId = "fake" | "openai-compatible";

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

export type FakeProviderConfig = {
  providerId: "fake";
  displayName: string;
};

export type ProviderConfig = FakeProviderConfig | OpenAICompatibleConfig;

