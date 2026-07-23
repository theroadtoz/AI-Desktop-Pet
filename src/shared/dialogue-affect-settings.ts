export type DialogueAffectSettings = {
  enabled: boolean;
};

export type DialogueAffectSettingsUpdate = Partial<DialogueAffectSettings>;

export const DIALOGUE_AFFECT_SETTINGS_SCHEMA_VERSION = 1;

export type DialogueAffectSettingsRecord = DialogueAffectSettings & {
  version: typeof DIALOGUE_AFFECT_SETTINGS_SCHEMA_VERSION;
};

type DialogueAffectSettingsRecordInput = {
  version?: unknown;
  enabled?: unknown;
};

export const DEFAULT_DIALOGUE_AFFECT_SETTINGS: DialogueAffectSettings = Object.freeze({
  enabled: true
});

export function normalizeDialogueAffectSettings(value: unknown): DialogueAffectSettings {
  return resolveDialogueAffectSettingsRecord(value);
}

export function cloneDialogueAffectSettings(settings: DialogueAffectSettings): DialogueAffectSettings {
  return { ...settings };
}

export function resolveDialogueAffectSettingsRecord(value: unknown): DialogueAffectSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultSettings();
  }

  const input = value as DialogueAffectSettingsRecordInput;
  if (isCurrentOrFutureVersion(input.version) && typeof input.enabled === "boolean") {
    return { enabled: input.enabled };
  }

  return createDefaultSettings();
}

export function createDialogueAffectSettingsRecord(
  settings: DialogueAffectSettings
): DialogueAffectSettingsRecord {
  return {
    version: DIALOGUE_AFFECT_SETTINGS_SCHEMA_VERSION,
    enabled: settings.enabled
  };
}

export function isFutureDialogueAffectSettingsRecord(
  value: unknown
): value is Record<string, unknown> & { version: number; enabled: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const input = value as DialogueAffectSettingsRecordInput;
  return typeof input.version === "number" &&
    Number.isSafeInteger(input.version) &&
    input.version > DIALOGUE_AFFECT_SETTINGS_SCHEMA_VERSION &&
    typeof input.enabled === "boolean";
}

function createDefaultSettings(): DialogueAffectSettings {
  return cloneDialogueAffectSettings(DEFAULT_DIALOGUE_AFFECT_SETTINGS);
}

function isCurrentOrFutureVersion(value: unknown): boolean {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= DIALOGUE_AFFECT_SETTINGS_SCHEMA_VERSION;
}
