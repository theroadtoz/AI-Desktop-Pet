import type {
  ProviderHealthCheckRequest,
  ProviderHealthResult,
  ProviderHealthStatus
} from "../../../shared/provider-health";
import type { TelemetryPayload } from "../telemetry";

type TelemetryLogger = (type: string, payload?: TelemetryPayload) => void;

export type ProviderHealthCheckOptions = {
  request: ProviderHealthCheckRequest;
  apiKey?: string | null;
  signal?: AbortSignal;
  logTelemetry?: TelemetryLogger;
};

type ModelsListResponse = {
  data?: unknown;
};

type ModelSummary = {
  id: string;
};

export async function checkProviderHealth(options: ProviderHealthCheckOptions): Promise<ProviderHealthResult> {
  const { request } = options;
  const baseURLHost = readBaseURLHost(request.baseURL);
  const startedAt = Date.now();

  if (!baseURLHost || !isValidTimeout(request.timeoutMs)) {
    const result = createResult(request, "invalid_config", baseURLHost);
    logHealth(options, result, Date.now() - startedAt);
    return result;
  }

  if (request.providerId === "openai-compatible") {
    const result = createResult(request, "invalid_config", baseURLHost);
    logHealth(options, result, Date.now() - startedAt);
    return result;
  }

  const controller = new AbortController();
  let timeoutReached = false;
  const timeoutId = setTimeout(() => {
    timeoutReached = true;
    controller.abort();
  }, request.timeoutMs);

  function abort(): void {
    controller.abort();
  }

  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    const headers: Record<string, string> = {
      Accept: "application/json"
    };

    const response = await fetch(createModelsURL(request.baseURL), {
      method: "GET",
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      const status = response.status === 401 || response.status === 403
        ? "missing_api_key"
        : "service_unreachable";
      const result = createResult(request, status, baseURLHost);
      logHealth(options, result, Date.now() - startedAt);
      return result;
    }

    const models = parseModelsList(await response.json());

    if (!models) {
      const result = createResult(request, "incompatible_response", baseURLHost);
      logHealth(options, result, Date.now() - startedAt);
      return result;
    }

    const hasModel = models.some((model) => model.id === request.model);
    const result = createResult(
      request,
      hasModel ? "ready" : "model_missing",
      baseURLHost,
      models.length
    );
    logHealth(options, result, Date.now() - startedAt);
    return result;
  } catch {
    const status: ProviderHealthStatus = options.signal?.aborted
      ? "cancelled"
      : timeoutReached
        ? "timeout"
        : "service_unreachable";
    const result = createResult(request, status, baseURLHost);
    logHealth(options, result, Date.now() - startedAt);
    return result;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function createModelsURL(baseURL: string): URL {
  const url = new URL(baseURL);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/models`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

function parseModelsList(value: unknown): ModelSummary[] | null {
  const response = value as ModelsListResponse | null;

  if (!response || typeof response !== "object" || !Array.isArray(response.data)) {
    return null;
  }

  const models: ModelSummary[] = [];

  for (const item of response.data) {
    const model = item as { id?: unknown; model?: unknown; name?: unknown } | null;
    const id = model && (model.id ?? model.model ?? model.name);

    if (typeof id !== "string" || id.length === 0) {
      return null;
    }

    models.push({ id });
  }

  return models;
}

function createResult(
  request: ProviderHealthCheckRequest,
  status: ProviderHealthStatus,
  baseURLHost?: string,
  modelCount?: number
): ProviderHealthResult {
  return {
    providerId: request.providerId,
    status,
    model: request.model,
    ...(baseURLHost ? { baseURLHost } : {}),
    ...(request.localPresetId ? { localPresetId: request.localPresetId } : {}),
    ...(typeof modelCount === "number" ? { modelCount } : {})
  };
}

function logHealth(
  options: ProviderHealthCheckOptions,
  result: ProviderHealthResult,
  durationMs: number
): void {
  options.logTelemetry?.("provider_health_checked", {
    providerId: result.providerId,
    status: result.status,
    model: result.model,
    baseURLHost: result.baseURLHost,
    localPresetId: result.localPresetId,
    modelCount: result.modelCount,
    durationMs
  });
}

function readBaseURLHost(baseURL: string): string | undefined {
  try {
    return new URL(baseURL).host;
  } catch {
    return undefined;
  }
}

function isValidTimeout(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
