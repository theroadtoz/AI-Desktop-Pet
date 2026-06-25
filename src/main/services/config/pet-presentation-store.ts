import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_PET_PRESENTATION_PREFERENCES,
  parsePetPresentationPreferences,
  parseStoredPetPresentationPreferences,
  type PetPresentationPreferences
} from "../../../shared/pet-presentation";

export type PetPresentationStore = {
  getPreferences(): PetPresentationPreferences;
  savePreferences(preferences: unknown): PetPresentationPreferences;
  getPreferencesPath(): string;
};

export function createPetPresentationStore(options: { userDataPath?: string } = {}): PetPresentationStore {
  const userDataPath = options.userDataPath ?? app.getPath("userData");
  const preferencesPath = join(userDataPath, "config", "pet-presentation.json");

  return {
    getPreferences() {
      if (!existsSync(preferencesPath)) {
        return DEFAULT_PET_PRESENTATION_PREFERENCES;
      }

      try {
        return parseStoredPetPresentationPreferences(readFileSync(preferencesPath, "utf8"));
      } catch {
        return DEFAULT_PET_PRESENTATION_PREFERENCES;
      }
    },
    savePreferences(value) {
      const preferences = parsePetPresentationPreferences(value);

      if (!preferences) {
        throw new Error("Invalid pet presentation preferences");
      }

      mkdirSync(dirname(preferencesPath), { recursive: true });
      writeFileSync(preferencesPath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
      return preferences;
    },
    getPreferencesPath() {
      return preferencesPath;
    }
  };
}
