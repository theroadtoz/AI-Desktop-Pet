import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  cloneProactiveCompanionSettings,
  DEFAULT_PROACTIVE_COMPANION_SETTINGS,
  isProactiveCompanionCadence,
  normalizeProactiveCompanionSettings,
  type ProactiveCompanionSettings
} from "../../../shared/proactive-companion-settings";

export type ProactiveCompanionSettingsStore = {
  getSettings(): ProactiveCompanionSettings;
  saveSettings(update: unknown): ProactiveCompanionSettings;
  getSettingsPath(): string;
};

export function createProactiveCompanionSettingsStore(
  options: { userDataPath?: string } = {}
): ProactiveCompanionSettingsStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const settingsPath = join(userDataPath, "config", "proactive-companion-settings.json");
  let settings = normalizeProactiveCompanionSettings(readSettingsFile(settingsPath));

  function save(): void {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }

  return {
    getSettings() {
      return cloneProactiveCompanionSettings(settings);
    },
    saveSettings(update) {
      settings = mergeSettingsUpdate(settings, update);
      save();
      return cloneProactiveCompanionSettings(settings);
    },
    getSettingsPath() {
      return settingsPath;
    }
  };
}

function readSettingsFile(settingsPath: string): unknown {
  if (!existsSync(settingsPath)) {
    return DEFAULT_PROACTIVE_COMPANION_SETTINGS;
  }

  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
  } catch {
    return DEFAULT_PROACTIVE_COMPANION_SETTINGS;
  }
}

function mergeSettingsUpdate(
  current: ProactiveCompanionSettings,
  update: unknown
): ProactiveCompanionSettings {
  if (!update || typeof update !== "object") {
    return cloneProactiveCompanionSettings(current);
  }

  const input = update as Partial<ProactiveCompanionSettings>;
  return {
    cadence: isProactiveCompanionCadence(input.cadence) ? input.cadence : current.cadence,
    memorySourceBubbles: typeof input.memorySourceBubbles === "boolean"
      ? input.memorySourceBubbles
      : current.memorySourceBubbles,
    searchSourceBubbles: typeof input.searchSourceBubbles === "boolean"
      ? input.searchSourceBubbles
      : current.searchSourceBubbles
  };
}
