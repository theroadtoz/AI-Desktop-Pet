import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_SHORTCUT_PREFERENCES,
  mergeShortcutPreferencesWithDefaults,
  parseShortcutPreferences,
  parseStoredShortcutPreferences,
  type ShortcutPreferences
} from "../../../shared/shortcut-preferences";

export type ShortcutPreferencesStore = {
  getPreferences(): ShortcutPreferences;
  savePreferences(preferences: unknown): ShortcutPreferences;
  getPreferencesPath(): string;
};

export function createShortcutPreferencesStore(options: { userDataPath?: string } = {}): ShortcutPreferencesStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const preferencesPath = join(userDataPath, "config", "shortcut-preferences.json");

  return {
    getPreferences() {
      if (!existsSync(preferencesPath)) {
        return DEFAULT_SHORTCUT_PREFERENCES;
      }

      try {
        return parseStoredShortcutPreferences(readFileSync(preferencesPath, "utf8"));
      } catch {
        return DEFAULT_SHORTCUT_PREFERENCES;
      }
    },
    savePreferences(value) {
      const preferences = parseShortcutPreferences(value);
      const merged = preferences ? mergeShortcutPreferencesWithDefaults(preferences) : null;

      if (!merged?.ok) {
        throw new Error("Invalid shortcut preferences");
      }

      mkdirSync(dirname(preferencesPath), { recursive: true });
      writeFileSync(preferencesPath, `${JSON.stringify(merged.preferences, null, 2)}\n`, "utf8");
      return merged.preferences;
    },
    getPreferencesPath() {
      return preferencesPath;
    }
  };
}
