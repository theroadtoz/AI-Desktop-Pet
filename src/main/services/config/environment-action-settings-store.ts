import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  cloneEnvironmentActionSettings,
  DEFAULT_ENVIRONMENT_ACTION_SETTINGS,
  normalizeEnvironmentActionSettings,
  type EnvironmentActionSettings
} from "../../../shared/environment-action-settings";

export type EnvironmentActionSettingsStore = {
  getSettings(): EnvironmentActionSettings;
  saveSettings(update: unknown): EnvironmentActionSettings;
  getEveningDateKey(): string | null;
  saveEveningDateKey(dateKey: string): void;
  getSettingsPath(): string;
  getRuntimeStatePath(): string;
};

export function createEnvironmentActionSettingsStore(
  options: { userDataPath?: string } = {}
): EnvironmentActionSettingsStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const settingsPath = join(userDataPath, "config", "environment-action-settings.json");
  const runtimeStatePath = join(userDataPath, "config", "environment-action-runtime-state.json");
  let settings = normalizeEnvironmentActionSettings(readSettingsFile(settingsPath));
  let eveningDateKey = readEveningDateKey(runtimeStatePath);

  function save(): void {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }

  return {
    getSettings() {
      return cloneEnvironmentActionSettings(settings);
    },
    saveSettings(update) {
      settings = mergeSettingsUpdate(settings, update);
      save();
      return cloneEnvironmentActionSettings(settings);
    },
    getEveningDateKey() {
      return eveningDateKey;
    },
    saveEveningDateKey(dateKey) {
      if (!isLocalDateKey(dateKey)) {
        return;
      }
      eveningDateKey = dateKey;
      mkdirSync(dirname(runtimeStatePath), { recursive: true });
      writeFileSync(runtimeStatePath, `${JSON.stringify({ lastEveningDateKey: dateKey }, null, 2)}\n`, "utf8");
    },
    getSettingsPath() {
      return settingsPath;
    },
    getRuntimeStatePath() {
      return runtimeStatePath;
    }
  };
}

function readEveningDateKey(runtimeStatePath: string): string | null {
  if (!existsSync(runtimeStatePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(runtimeStatePath, "utf8")) as {
      lastEveningDateKey?: unknown;
    };
    return typeof parsed.lastEveningDateKey === "string" && isLocalDateKey(parsed.lastEveningDateKey)
      ? parsed.lastEveningDateKey
      : null;
  } catch {
    return null;
  }
}

function isLocalDateKey(value: string): boolean {
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(value);
}

function readSettingsFile(settingsPath: string): unknown {
  if (!existsSync(settingsPath)) {
    return DEFAULT_ENVIRONMENT_ACTION_SETTINGS;
  }

  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
  } catch {
    return DEFAULT_ENVIRONMENT_ACTION_SETTINGS;
  }
}

function mergeSettingsUpdate(
  current: EnvironmentActionSettings,
  update: unknown
): EnvironmentActionSettings {
  if (!update || typeof update !== "object") {
    return cloneEnvironmentActionSettings(current);
  }

  const input = update as Partial<EnvironmentActionSettings>;
  return {
    musicEnabled: typeof input.musicEnabled === "boolean"
      ? input.musicEnabled
      : current.musicEnabled,
    gameEnabled: typeof input.gameEnabled === "boolean"
      ? input.gameEnabled
      : current.gameEnabled
  };
}
