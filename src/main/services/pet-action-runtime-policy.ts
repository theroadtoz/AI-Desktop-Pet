import type { DialogueModeId } from "../../shared/dialogue-style";
import type { PresenceModeId } from "../../shared/presence-mode";
import type { PetActionTriggerReason } from "../../shared/pet-action-trigger";
import type { EmotionIntensity } from "../../shared/emotion";

export const PET_LONG_WORK_THRESHOLD_MS = 120 * 60_000;
export const PET_LONG_WORK_COOLDOWN_MS = 4 * 60 * 60_000;

export type PetActionRuntimePolicy = {
  syncDialogueMode(modeId: DialogueModeId): void;
  syncPresenceMode(modeId: PresenceModeId): void;
  syncEveningDateKey(dateKey: string | null): void;
  onDialogueModeChanged(modeId: DialogueModeId, presenceModeId: PresenceModeId): PetActionTriggerReason | null;
  onPresenceModeChanged(modeId: PresenceModeId): void;
  onCompanionTick(input: {
    presenceModeId: PresenceModeId;
    timeBand: "morning" | "afternoon" | "evening" | "night";
  }): PetActionTriggerReason | null;
};

export function createPetActionRuntimePolicy({
  now = Date.now,
  localDateKey = defaultLocalDateKey,
  persistEveningDateKey = () => {}
}: {
  now?: () => number;
  localDateKey?: (timestampMs: number) => string;
  persistEveningDateKey?: (dateKey: string) => void;
} = {}): PetActionRuntimePolicy {
  let currentModeId: DialogueModeId = "default";
  let currentPresenceModeId: PresenceModeId = "default";
  let workStartedAtMs: number | null = null;
  let lastWorkRecoveryAtMs: number | null = null;
  let lastEveningDateKey: string | null = null;

  function syncDialogueMode(modeId: DialogueModeId): void {
    currentModeId = modeId;
    workStartedAtMs = modeId === "work" && currentPresenceModeId !== "sleep" ? now() : null;
  }

  function syncPresenceMode(modeId: PresenceModeId): void {
    currentPresenceModeId = modeId;
    if (modeId === "sleep") {
      workStartedAtMs = null;
    } else if (currentModeId === "work" && workStartedAtMs === null) {
      workStartedAtMs = now();
    }
  }

  return {
    syncDialogueMode,
    syncPresenceMode,
    syncEveningDateKey(dateKey) {
      lastEveningDateKey = dateKey;
    },
    onDialogueModeChanged(modeId, presenceModeId) {
      const timestampMs = now();
      currentPresenceModeId = presenceModeId;
      const completedWorkDurationMs = currentModeId === "work" &&
        currentPresenceModeId !== "sleep" &&
        workStartedAtMs !== null
        ? timestampMs - workStartedAtMs
        : 0;
      currentModeId = modeId;
      workStartedAtMs = modeId === "work" && currentPresenceModeId !== "sleep" ? timestampMs : null;

      if (
        completedWorkDurationMs < PET_LONG_WORK_THRESHOLD_MS ||
        presenceModeId === "sleep" ||
        (lastWorkRecoveryAtMs !== null && timestampMs - lastWorkRecoveryAtMs < PET_LONG_WORK_COOLDOWN_MS)
      ) {
        return null;
      }

      lastWorkRecoveryAtMs = timestampMs;
      return "long_work_session_complete";
    },
    onPresenceModeChanged(modeId) {
      const previousPresenceModeId = currentPresenceModeId;
      currentPresenceModeId = modeId;
      if (modeId === "sleep") {
        workStartedAtMs = null;
      } else if (
        previousPresenceModeId === "sleep" &&
        currentModeId === "work"
      ) {
        workStartedAtMs = now();
      }
    },
    onCompanionTick({ presenceModeId, timeBand }) {
      if (presenceModeId === "sleep" || (timeBand !== "evening" && timeBand !== "night")) {
        return null;
      }

      const timestampMs = now();
      const dateKey = localDateKey(timestampMs);
      if (dateKey === lastEveningDateKey) {
        return null;
      }

      lastEveningDateKey = dateKey;
      persistEveningDateKey(dateKey);
      return "evening_companion_tick";
    }
  };
}

export function shouldTriggerReplyWarmSettle({
  completed,
  hasSearchCitation,
  intensity
}: {
  completed: boolean;
  hasSearchCitation: boolean;
  intensity: EmotionIntensity;
}): boolean {
  return completed && !hasSearchCitation && intensity !== "high";
}

function defaultLocalDateKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
