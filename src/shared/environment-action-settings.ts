export type EnvironmentActionSettings = {
  musicEnabled: boolean;
  gameEnabled: boolean;
};

export type EnvironmentActionSettingsUpdate = Partial<EnvironmentActionSettings>;

export type EnvironmentActionProviderStatus = "unknown" | "available" | "unavailable" | "failed";
export type EnvironmentActionMonitorStatus = "stopped" | "waiting-for-renderer" | "polling" | "backoff";
export type EnvironmentActionCapability = "unknown" | "available" | "unavailable";

export type EnvironmentActionRuntimeStatus = {
  providerStatus: EnvironmentActionProviderStatus;
  monitorStatus: EnvironmentActionMonitorStatus;
  mediaCapability: EnvironmentActionCapability;
  gameCapability: EnvironmentActionCapability;
};

export type EnvironmentActionSettingsSelection = {
  musicEnabled: boolean;
  gameEnabled: boolean;
};

export const ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION = 2;

export type EnvironmentActionSettingsRecord = EnvironmentActionSettings & {
  version: typeof ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION;
  userSelected: EnvironmentActionSettingsSelection;
};

export type EnvironmentActionSettingsResolution = {
  settings: EnvironmentActionSettings;
  userSelected: EnvironmentActionSettingsSelection;
};

export const DEFAULT_ENVIRONMENT_ACTION_SETTINGS: EnvironmentActionSettings = Object.freeze({
  musicEnabled: true,
  gameEnabled: true
});

const DEFAULT_USER_SELECTION: EnvironmentActionSettingsSelection = Object.freeze({
  musicEnabled: false,
  gameEnabled: false
});

export function normalizeEnvironmentActionSettings(value: unknown): EnvironmentActionSettings {
  return resolveEnvironmentActionSettingsRecord(value).settings;
}

export function cloneEnvironmentActionSettings(
  settings: EnvironmentActionSettings
): EnvironmentActionSettings {
  return { ...settings };
}

export function resolveEnvironmentActionSettingsRecord(value: unknown): EnvironmentActionSettingsResolution {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultResolution();
  }

  const input = value as Partial<EnvironmentActionSettingsRecord>;
  if (isSelection(input.userSelected)) {
    return {
      settings: {
        musicEnabled: readSelectedValue(input.musicEnabled, input.userSelected.musicEnabled),
        gameEnabled: readSelectedValue(input.gameEnabled, input.userSelected.gameEnabled)
      },
      userSelected: { ...input.userSelected }
    };
  }

  if ("version" in input) {
    return createDefaultResolution();
  }

  if (typeof input.musicEnabled === "boolean" && typeof input.gameEnabled === "boolean") {
    const legacyOptOut = input.musicEnabled === false && input.gameEnabled === false;
    return {
      settings: {
        musicEnabled: input.musicEnabled,
        gameEnabled: input.gameEnabled
      },
      userSelected: legacyOptOut
        ? { musicEnabled: true, gameEnabled: true }
        : { ...DEFAULT_USER_SELECTION }
    };
  }

  return createDefaultResolution();
}

export function createEnvironmentActionSettingsRecord(
  settings: EnvironmentActionSettings,
  userSelected: EnvironmentActionSettingsSelection
): EnvironmentActionSettingsRecord {
  return {
    version: ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION,
    musicEnabled: settings.musicEnabled,
    gameEnabled: settings.gameEnabled,
    userSelected: { ...userSelected }
  };
}

function createDefaultResolution(): EnvironmentActionSettingsResolution {
  return {
    settings: cloneEnvironmentActionSettings(DEFAULT_ENVIRONMENT_ACTION_SETTINGS),
    userSelected: { ...DEFAULT_USER_SELECTION }
  };
}

function isSelection(value: unknown): value is EnvironmentActionSettingsSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const selection = value as Partial<EnvironmentActionSettingsSelection>;
  return typeof selection.musicEnabled === "boolean" && typeof selection.gameEnabled === "boolean";
}

function readSelectedValue(value: unknown, selected: boolean): boolean {
  if (!selected) {
    return true;
  }
  return typeof value === "boolean" ? value : true;
}
