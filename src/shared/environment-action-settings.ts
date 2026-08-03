export type EnvironmentActionSettings = {
  basicEnabled: boolean;
  musicEnabled: boolean;
  explicitGameContextEnabled: boolean;
};

export type EnvironmentActionSettingsUpdate = Partial<EnvironmentActionSettings>;

export type EnvironmentActionProviderStatus = "unknown" | "available" | "unavailable" | "failed";
export type EnvironmentActionMonitorStatus = "stopped" | "polling" | "backoff";
export type EnvironmentActionCapability = "unknown" | "available" | "unavailable";

export type EnvironmentActionRuntimeStatus = {
  providerStatus: EnvironmentActionProviderStatus;
  monitorStatus: EnvironmentActionMonitorStatus;
  mediaCapability: EnvironmentActionCapability;
  gameCapability: EnvironmentActionCapability;
};

export type EnvironmentActionSettingsSelection = {
  basicEnabled: boolean;
  musicEnabled: boolean;
  explicitGameContextEnabled: boolean;
};

export const ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION = 4;

export type EnvironmentActionSettingsRecord = EnvironmentActionSettings & {
  version: typeof ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION;
  userSelected: EnvironmentActionSettingsSelection;
};

export type EnvironmentActionSettingsResolution = {
  settings: EnvironmentActionSettings;
  userSelected: EnvironmentActionSettingsSelection;
};

export const DEFAULT_ENVIRONMENT_ACTION_SETTINGS: EnvironmentActionSettings = Object.freeze({
  basicEnabled: true,
  musicEnabled: true,
  explicitGameContextEnabled: true
});

const DEFAULT_USER_SELECTION: EnvironmentActionSettingsSelection = Object.freeze({
  basicEnabled: false,
  musicEnabled: false,
  explicitGameContextEnabled: false
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
  void value;
  return createDefaultResolution();
}

export function createEnvironmentActionSettingsRecord(
  settings: EnvironmentActionSettings,
  userSelected: EnvironmentActionSettingsSelection
): EnvironmentActionSettingsRecord {
  void settings;
  void userSelected;
  return {
    version: ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION,
    basicEnabled: true,
    musicEnabled: true,
    explicitGameContextEnabled: true,
    userSelected: { ...DEFAULT_USER_SELECTION }
  };
}

function createDefaultResolution(): EnvironmentActionSettingsResolution {
  return {
    settings: cloneEnvironmentActionSettings(DEFAULT_ENVIRONMENT_ACTION_SETTINGS),
    userSelected: { ...DEFAULT_USER_SELECTION }
  };
}
