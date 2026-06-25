import type { PetPresentationPreferences } from "../../../shared/pet-presentation";
import type { PetPresentationStore } from "./pet-presentation-store";

const DEFAULT_PERSIST_DELAY_MS = 220;

export type PetPresentationPersistence = {
  schedule(preferences: PetPresentationPreferences): void;
  saveNow(preferences: PetPresentationPreferences): PetPresentationPreferences;
  flush(): PetPresentationPreferences | null;
};

export function createPetPresentationPersistence(
  store: Pick<PetPresentationStore, "savePreferences">,
  delayMs = DEFAULT_PERSIST_DELAY_MS
): PetPresentationPersistence {
  let pendingPreferences: PetPresentationPreferences | null = null;
  let timer: NodeJS.Timeout | null = null;

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flush(): PetPresentationPreferences | null {
    clearTimer();

    if (!pendingPreferences) {
      return null;
    }

    const preferences = pendingPreferences;
    pendingPreferences = null;
    return store.savePreferences(preferences);
  }

  return {
    schedule(preferences) {
      pendingPreferences = preferences;
      clearTimer();
      timer = setTimeout(() => {
        flush();
      }, delayMs);
    },
    saveNow(preferences) {
      pendingPreferences = null;
      clearTimer();
      return store.savePreferences(preferences);
    },
    flush
  };
}
