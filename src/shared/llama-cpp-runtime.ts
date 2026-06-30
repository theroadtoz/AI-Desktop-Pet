export type LlamaCppRuntimeStatus =
  | "disabled"
  | "missing_binary"
  | "missing_model"
  | "starting"
  | "ready"
  | "exited"
  | "timeout"
  | "error";

export type LlamaCppRuntimeSafeSummary = {
  runtime: "llama.cpp";
  enabled: boolean;
  status: LlamaCppRuntimeStatus;
  safeSummaryOnly: true;
  executableConfigured: boolean;
  modelConfigured: boolean;
  executableName?: string;
  modelName?: string;
  host?: string;
  port?: number;
  ctxSize?: number;
  baseURLHost?: string;
  alias?: string | undefined;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  healthPollIntervalMs?: number;
  durationMs?: number;
  startupMs?: number;
  exitCode?: number | null;
  signal?: string | null;
  stdoutBytes?: number;
  stderrBytes?: number;
  reason?: "invalid_model_extension" | "spawn_failed" | "health_timeout" | "stop_timeout";
};

export type LlamaCppRuntimeSettingsUpdate = {
  enabled?: boolean;
  host?: string;
  port?: number | null;
  ctxSize?: number | null;
  alias?: string;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  healthPollIntervalMs?: number;
};
