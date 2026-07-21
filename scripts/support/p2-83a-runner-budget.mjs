const BASE_TIMEOUT_MS = 45_000;
const PER_CASE_TIMEOUT_MS = 35_000;
const MIN_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 420_000;

export function calculateRunnerTotalTimeoutMs(caseCount, overrideValue) {
  if (!Number.isSafeInteger(caseCount) || caseCount < 0) {
    throw new TypeError("invalid_runner_case_count");
  }
  const defaultTimeoutMs = clamp(BASE_TIMEOUT_MS + caseCount * PER_CASE_TIMEOUT_MS);
  if (overrideValue === undefined || overrideValue === null || overrideValue === "") {
    return defaultTimeoutMs;
  }
  const parsedOverride = Number(overrideValue);
  return Number.isFinite(parsedOverride) ? clamp(Math.trunc(parsedOverride)) : defaultTimeoutMs;
}

function clamp(value) {
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, value));
}
