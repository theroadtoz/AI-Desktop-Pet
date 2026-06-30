export type LocalModelDiagnosticStatus = "ready" | "not_ready" | "script_failed";

export type LocalModelDiagnosticRuntimeStatus =
  | "ready"
  | "not_installed_or_unreachable"
  | "model_missing"
  | "chat_failed"
  | "env_configured"
  | "skipped";

export type LocalModelDiagnosticEndpointStatus =
  | "ready"
  | "model_missing"
  | "service_unreachable"
  | "incompatible_response"
  | "chat_failed"
  | "skipped";

export type LocalModelDiagnosticRuntimeSummary = {
  id: string;
  label: string;
  status: LocalModelDiagnosticRuntimeStatus;
  baseURLHost?: string;
  model?: string;
  reason?: string;
  nextAction?: string;
  commandFound?: boolean;
  processFound?: boolean;
  tcpReachable?: boolean;
  modelsStatus?: LocalModelDiagnosticEndpointStatus;
  chatStatus?: LocalModelDiagnosticEndpointStatus;
  modelCount?: number;
  firstTokenMs?: number;
  replyLength?: number;
  modelsCheckMs?: number;
  chatCheckMs?: number;
  durationMs?: number;
  managedEnabled?: boolean;
  executableConfigured?: boolean;
  modelConfigured?: boolean;
};

export type LocalModelDiagnosticSafeSummary = {
  ok: boolean;
  status: LocalModelDiagnosticStatus;
  recommendedRuntime: string;
  durationMs: number;
  safeSummaryOnly: true;
  runtimes: LocalModelDiagnosticRuntimeSummary[];
};

const runtimeStatuses: readonly LocalModelDiagnosticRuntimeStatus[] = [
  "ready",
  "not_installed_or_unreachable",
  "model_missing",
  "chat_failed",
  "env_configured",
  "skipped"
];

const endpointStatuses: readonly LocalModelDiagnosticEndpointStatus[] = [
  "ready",
  "model_missing",
  "service_unreachable",
  "incompatible_response",
  "chat_failed",
  "skipped"
];

const summaryStatuses: readonly LocalModelDiagnosticStatus[] = [
  "ready",
  "not_ready",
  "script_failed"
];

const unsafeDiagnosticFieldNames = new Set([
  "body",
  "prompt",
  "request",
  "messages",
  "content",
  "apikey"
]);

export function hasUnsafeLocalModelDiagnosticField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasUnsafeLocalModelDiagnosticField);
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const compactKey = normalizedKey.replace(/[^a-z0-9]/g, "");

    if (
      normalizedKey.includes("path") ||
      unsafeDiagnosticFieldNames.has(normalizedKey) ||
      unsafeDiagnosticFieldNames.has(compactKey) ||
      compactKey.includes("body") ||
      compactKey.includes("prompt") ||
      compactKey.includes("request") ||
      compactKey.includes("apikey")
    ) {
      return true;
    }

    if (hasUnsafeLocalModelDiagnosticField(nestedValue)) {
      return true;
    }
  }

  return false;
}

export function parseLocalModelDiagnosticSafeSummary(value: unknown): LocalModelDiagnosticSafeSummary | null {
  const summary = value as Partial<LocalModelDiagnosticSafeSummary> | null;

  if (
    !summary ||
    typeof summary !== "object" ||
    hasUnsafeLocalModelDiagnosticField(summary) ||
    summary.safeSummaryOnly !== true ||
    typeof summary.ok !== "boolean" ||
    typeof summary.status !== "string" ||
    !summaryStatuses.includes(summary.status as LocalModelDiagnosticStatus) ||
    typeof summary.recommendedRuntime !== "string" ||
    !isSafeDiagnosticText(summary.recommendedRuntime) ||
    !isSafeDiagnosticNumber(summary.durationMs) ||
    !Array.isArray(summary.runtimes)
  ) {
    return null;
  }

  const runtimes = summary.runtimes.map(parseLocalModelDiagnosticRuntimeSummary);

  if (runtimes.some((runtime) => runtime === null)) {
    return null;
  }

  return {
    ok: summary.ok,
    status: summary.status as LocalModelDiagnosticStatus,
    recommendedRuntime: summary.recommendedRuntime,
    durationMs: summary.durationMs,
    safeSummaryOnly: true,
    runtimes: runtimes as LocalModelDiagnosticRuntimeSummary[]
  };
}

function parseLocalModelDiagnosticRuntimeSummary(value: unknown): LocalModelDiagnosticRuntimeSummary | null {
  const runtime = value as Partial<LocalModelDiagnosticRuntimeSummary> | null;

  if (
    !runtime ||
    typeof runtime !== "object" ||
    typeof runtime.id !== "string" ||
    !isSafeDiagnosticText(runtime.id) ||
    typeof runtime.label !== "string" ||
    !isSafeDiagnosticText(runtime.label) ||
    typeof runtime.status !== "string" ||
    !runtimeStatuses.includes(runtime.status as LocalModelDiagnosticRuntimeStatus) ||
    !isOptionalSafeDiagnosticText(runtime.baseURLHost) ||
    !isOptionalSafeDiagnosticText(runtime.model) ||
    !isOptionalSafeDiagnosticText(runtime.reason) ||
    !isOptionalSafeDiagnosticText(runtime.nextAction) ||
    !isOptionalBoolean(runtime.commandFound) ||
    !isOptionalBoolean(runtime.processFound) ||
    !isOptionalBoolean(runtime.tcpReachable) ||
    !isOptionalEndpointStatus(runtime.modelsStatus) ||
    !isOptionalEndpointStatus(runtime.chatStatus) ||
    !isOptionalSafeDiagnosticNumber(runtime.modelCount) ||
    !isOptionalSafeDiagnosticNumber(runtime.firstTokenMs) ||
    !isOptionalSafeDiagnosticNumber(runtime.replyLength) ||
    !isOptionalSafeDiagnosticNumber(runtime.modelsCheckMs) ||
    !isOptionalSafeDiagnosticNumber(runtime.chatCheckMs) ||
    !isOptionalSafeDiagnosticNumber(runtime.durationMs) ||
    !isOptionalBoolean(runtime.managedEnabled) ||
    !isOptionalBoolean(runtime.executableConfigured) ||
    !isOptionalBoolean(runtime.modelConfigured)
  ) {
    return null;
  }

  return {
    id: runtime.id,
    label: runtime.label,
    status: runtime.status as LocalModelDiagnosticRuntimeStatus,
    ...(runtime.baseURLHost ? { baseURLHost: runtime.baseURLHost } : {}),
    ...(runtime.model ? { model: runtime.model } : {}),
    ...(runtime.reason ? { reason: runtime.reason } : {}),
    ...(runtime.nextAction ? { nextAction: runtime.nextAction } : {}),
    ...(typeof runtime.commandFound === "boolean" ? { commandFound: runtime.commandFound } : {}),
    ...(typeof runtime.processFound === "boolean" ? { processFound: runtime.processFound } : {}),
    ...(typeof runtime.tcpReachable === "boolean" ? { tcpReachable: runtime.tcpReachable } : {}),
    ...(runtime.modelsStatus ? { modelsStatus: runtime.modelsStatus } : {}),
    ...(runtime.chatStatus ? { chatStatus: runtime.chatStatus } : {}),
    ...(typeof runtime.modelCount === "number" ? { modelCount: runtime.modelCount } : {}),
    ...(typeof runtime.firstTokenMs === "number" ? { firstTokenMs: runtime.firstTokenMs } : {}),
    ...(typeof runtime.replyLength === "number" ? { replyLength: runtime.replyLength } : {}),
    ...(typeof runtime.modelsCheckMs === "number" ? { modelsCheckMs: runtime.modelsCheckMs } : {}),
    ...(typeof runtime.chatCheckMs === "number" ? { chatCheckMs: runtime.chatCheckMs } : {}),
    ...(typeof runtime.durationMs === "number" ? { durationMs: runtime.durationMs } : {}),
    ...(typeof runtime.managedEnabled === "boolean" ? { managedEnabled: runtime.managedEnabled } : {}),
    ...(typeof runtime.executableConfigured === "boolean" ? { executableConfigured: runtime.executableConfigured } : {}),
    ...(typeof runtime.modelConfigured === "boolean" ? { modelConfigured: runtime.modelConfigured } : {})
  };
}

function isOptionalEndpointStatus(value: unknown): boolean {
  return value === undefined || (
    typeof value === "string" &&
    endpointStatuses.includes(value as LocalModelDiagnosticEndpointStatus)
  );
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isOptionalSafeDiagnosticText(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && isSafeDiagnosticText(value));
}

function isSafeDiagnosticText(value: string): boolean {
  return (
    value.length <= 240 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/[A-Za-z]:\\/.test(value) &&
    !/(^|[\s([{])\/(?:home|Users|Volumes|mnt|var|tmp|opt|usr|etc)\//.test(value)
  );
}

function isSafeDiagnosticNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isOptionalSafeDiagnosticNumber(value: unknown): boolean {
  return value === undefined || isSafeDiagnosticNumber(value);
}
