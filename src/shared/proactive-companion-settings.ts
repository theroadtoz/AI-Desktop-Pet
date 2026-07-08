export const PROACTIVE_COMPANION_CADENCES = [
  "normal",
  "quiet",
  "off"
] as const;

export type ProactiveCompanionCadence = typeof PROACTIVE_COMPANION_CADENCES[number];

export type ProactiveCompanionSettings = {
  cadence: ProactiveCompanionCadence;
  memorySourceBubbles: boolean;
  searchSourceBubbles: boolean;
};

export type ProactiveCompanionSettingsUpdate = Partial<ProactiveCompanionSettings>;

export const DEFAULT_PROACTIVE_COMPANION_SETTINGS: ProactiveCompanionSettings = Object.freeze({
  cadence: "normal",
  memorySourceBubbles: true,
  searchSourceBubbles: true
});

export const PROACTIVE_COMPANION_CADENCE_LABELS: Readonly<Record<ProactiveCompanionCadence, string>> = {
  normal: "标准陪伴",
  quiet: "轻声陪伴",
  off: "关闭气泡"
};

export const PROACTIVE_COMPANION_CADENCE_DESCRIPTIONS: Readonly<Record<ProactiveCompanionCadence, string>> = {
  normal: "保持当前低频主动气泡节奏。",
  quiet: "降低主动气泡频率，仍保留轻量状态回声。",
  off: "不显示自动主动气泡。"
};

const QUIET_CADENCE_INTERVAL_MULTIPLIER = 3;
const MIN_QUIET_CADENCE_INTERVAL_MS = 30 * 60_000;
const MIN_ACCEPTANCE_QUIET_CADENCE_INTERVAL_MS = 1_800;

export function isProactiveCompanionCadence(value: unknown): value is ProactiveCompanionCadence {
  return typeof value === "string" &&
    PROACTIVE_COMPANION_CADENCES.includes(value as ProactiveCompanionCadence);
}

export function normalizeProactiveCompanionSettings(value: unknown): ProactiveCompanionSettings {
  const input = value as Partial<ProactiveCompanionSettings> | null;

  return {
    cadence: isProactiveCompanionCadence(input?.cadence)
      ? input.cadence
      : DEFAULT_PROACTIVE_COMPANION_SETTINGS.cadence,
    memorySourceBubbles: typeof input?.memorySourceBubbles === "boolean"
      ? input.memorySourceBubbles
      : DEFAULT_PROACTIVE_COMPANION_SETTINGS.memorySourceBubbles,
    searchSourceBubbles: typeof input?.searchSourceBubbles === "boolean"
      ? input.searchSourceBubbles
      : DEFAULT_PROACTIVE_COMPANION_SETTINGS.searchSourceBubbles
  };
}

export function cloneProactiveCompanionSettings(
  settings: ProactiveCompanionSettings
): ProactiveCompanionSettings {
  return { ...settings };
}

export function getProactiveCompanionIdleIntervalMs(
  settings: ProactiveCompanionSettings,
  baseIntervalMs: number,
  options: { acceptance?: boolean } = {}
): number | null {
  if (settings.cadence === "off") {
    return null;
  }

  const safeBaseIntervalMs = Number.isFinite(baseIntervalMs) && baseIntervalMs > 0
    ? Math.round(baseIntervalMs)
    : 12 * 60_000;

  if (settings.cadence === "normal") {
    return safeBaseIntervalMs;
  }

  return Math.max(
    Math.round(safeBaseIntervalMs * QUIET_CADENCE_INTERVAL_MULTIPLIER),
    options.acceptance ? MIN_ACCEPTANCE_QUIET_CADENCE_INTERVAL_MS : MIN_QUIET_CADENCE_INTERVAL_MS
  );
}

export function shouldQueueProactiveCompanionSourceBubble(
  settings: ProactiveCompanionSettings,
  source: "memory" | "search"
): boolean {
  if (settings.cadence === "off") {
    return false;
  }

  return source === "memory"
    ? settings.memorySourceBubbles
    : settings.searchSourceBubbles;
}
