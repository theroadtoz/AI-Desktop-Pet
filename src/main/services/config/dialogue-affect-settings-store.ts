import { app } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import {
  cloneDialogueAffectSettings,
  createDialogueAffectSettingsRecord,
  isFutureDialogueAffectSettingsRecord,
  normalizeDialogueAffectSettings,
  type DialogueAffectSettings
} from "../../../shared/dialogue-affect-settings";

export type DialogueAffectSettingsStore = {
  getSettings(): DialogueAffectSettings;
  saveSettings(update: unknown): DialogueAffectSettings;
  getSettingsPath(): string;
};

export function createDialogueAffectSettingsStore(
  options: { userDataPath?: string } = {}
): DialogueAffectSettingsStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const settingsPath = join(userDataPath, "config", "dialogue-affect-settings.json");
  const loadedRecord = readSettingsFile(settingsPath);
  let settings = normalizeDialogueAffectSettings(loadedRecord);
  let futureRecord = isFutureDialogueAffectSettingsRecord(loadedRecord)
    ? { ...loadedRecord }
    : null;

  function save(nextSettings: DialogueAffectSettings): void {
    const nextRecord = futureRecord
      ? { ...futureRecord, enabled: nextSettings.enabled }
      : createDialogueAffectSettingsRecord(nextSettings);
    writeAtomically(settingsPath, `${JSON.stringify(nextRecord, null, 2)}\n`);
    settings = nextSettings;
    if (futureRecord) {
      futureRecord = nextRecord;
    }
  }

  return {
    getSettings() {
      return cloneDialogueAffectSettings(settings);
    },
    saveSettings(update) {
      const nextSettings = mergeSettingsUpdate(settings, update);
      save(nextSettings);
      return cloneDialogueAffectSettings(settings);
    },
    getSettingsPath() {
      return settingsPath;
    }
  };
}

function writeAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, "utf8");
    renameSync(temporaryPath, path);
  } catch (error) {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
    throw error;
  }
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
  current: DialogueAffectSettings,
  update: unknown
): DialogueAffectSettings {
  if (!update || typeof update !== "object") {
    return cloneDialogueAffectSettings(current);
  }

  const input = update as Partial<DialogueAffectSettings>;
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled
  };
}
