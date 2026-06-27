import type { LocalProviderPresetId, ProviderId } from "./provider-config";

export type ProviderHealthStatus =
  | "ready"
  | "model_missing"
  | "incompatible_response"
  | "service_unreachable"
  | "timeout"
  | "missing_api_key"
  | "cancelled"
  | "invalid_config";

export type ProviderHealthCheckRequest = {
  providerId: Extract<ProviderId, "openai-compatible" | "local-openai-compatible">;
  baseURL: string;
  model: string;
  timeoutMs: number;
  localPresetId?: LocalProviderPresetId;
};

export type ProviderHealthResult = {
  providerId: ProviderHealthCheckRequest["providerId"];
  status: ProviderHealthStatus;
  model: string;
  baseURLHost?: string;
  localPresetId?: LocalProviderPresetId;
  modelCount?: number;
};
