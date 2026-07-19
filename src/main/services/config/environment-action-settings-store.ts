import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  cloneEnvironmentActionSettings,
  createEnvironmentActionSettingsRecord,
  resolveEnvironmentActionSettingsRecord,
  type EnvironmentActionSettings,
  type EnvironmentActionSettingsSelection
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
  const loadedSettings = resolveEnvironmentActionSettingsRecord(readSettingsFile(settingsPath));
  let settings = loadedSettings.settings;
  let userSelected = loadedSettings.userSelected;
  let eveningDateKey = readEveningDateKey(runtimeStatePath);

  function save(): void {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      `${JSON.stringify(createEnvironmentActionSettingsRecord(settings, userSelected), null, 2)}\n`,
      "utf8"
    );
  }

  return {
    getSettings() {
      return cloneEnvironmentActionSettings(settings);
    },
    saveSettings(update) {
      const merged = mergeSettingsUpdate(settings, userSelected, update);
      settings = merged.settings;
      userSelected = merged.userSelected;
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
    return null;
  }

  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function mergeSettingsUpdate(
  current: EnvironmentActionSettings,
  currentUserSelected: EnvironmentActionSettingsSelection,
  update: unknown
): { settings: EnvironmentActionSettings; userSelected: EnvironmentActionSettingsSelection } {
  if (!update || typeof update !== "object") {
    return {
      settings: cloneEnvironmentActionSettings(current),
      userSelected: { ...currentUserSelected }
    };
  }

  const input = update as Partial<EnvironmentActionSettings>;
  return {
    settings: {
      musicEnabled: typeof input.musicEnabled === "boolean"
        ? input.musicEnabled
        : current.musicEnabled,
      gameEnabled: typeof input.gameEnabled === "boolean"
        ? input.gameEnabled
        : current.gameEnabled
    },
    userSelected: {
      musicEnabled: typeof input.musicEnabled === "boolean"
        ? true
        : currentUserSelected.musicEnabled,
      gameEnabled: typeof input.gameEnabled === "boolean"
        ? true
        : currentUserSelected.gameEnabled
    }
  };
}
