export type EnvironmentActionSettings = {
  basicEnabled: boolean;
  musicEnabled: boolean;
  gameEnabled: boolean;
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
  gameEnabled: boolean;
};

export const ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION = 3;

export type EnvironmentActionSettingsRecord = EnvironmentActionSettings & {
  version: typeof ENVIRONMENT_ACTION_SETTINGS_SCHEMA_VERSION;
  userSelected: EnvironmentActionSettingsSelection;
};

export type EnvironmentActionSettingsResolution = {
  settings: EnvironmentActionSettings;
  userSelected: EnvironmentActionSettingsSelection;
};

type EnvironmentActionSettingsRecordInput = {
  version?: unknown;
  basicEnabled?: unknown;
  musicEnabled?: unknown;
  gameEnabled?: unknown;
  userSelected?: unknown;
};

export const DEFAULT_ENVIRONMENT_ACTION_SETTINGS: EnvironmentActionSettings = Object.freeze({
  basicEnabled: true,
  musicEnabled: true,
  gameEnabled: true
});

const DEFAULT_USER_SELECTION: EnvironmentActionSettingsSelection = Object.freeze({
  basicEnabled: false,
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

  const input = value as EnvironmentActionSettingsRecordInput;
  if (hasSettingsValues(input) && isSelection(input.userSelected)) {
    return {
      settings: {
        basicEnabled: readSelectedValue(input.basicEnabled, input.userSelected.basicEnabled),
        musicEnabled: readSelectedValue(input.musicEnabled, input.userSelected.musicEnabled),
        gameEnabled: readSelectedValue(input.gameEnabled, input.userSelected.gameEnabled)
      },
      userSelected: { ...input.userSelected }
    };
  }

  if (input.version === 2 && hasV2SettingsValues(input) && isV2Selection(input.userSelected)) {
    return {
      settings: {
        basicEnabled: true,
        musicEnabled: readSelectedValue(input.musicEnabled, input.userSelected.musicEnabled),
        gameEnabled: readSelectedValue(input.gameEnabled, input.userSelected.gameEnabled)
      },
      userSelected: {
        basicEnabled: false,
        musicEnabled: input.userSelected.musicEnabled,
        gameEnabled: input.userSelected.gameEnabled
      }
    };
  }

  if ("version" in input) {
    return createDefaultResolution();
  }

  if (input.musicEnabled === false && input.gameEnabled === false) {
    return {
      settings: {
        basicEnabled: false,
        musicEnabled: false,
        gameEnabled: false
      },
      userSelected: {
        basicEnabled: true,
        musicEnabled: true,
        gameEnabled: true
      }
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
    basicEnabled: settings.basicEnabled,
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
  return typeof selection.basicEnabled === "boolean" &&
    typeof selection.musicEnabled === "boolean" &&
    typeof selection.gameEnabled === "boolean";
}

function hasSettingsValues(value: EnvironmentActionSettingsRecordInput): value is EnvironmentActionSettings & EnvironmentActionSettingsRecordInput {
  return typeof value.basicEnabled === "boolean" &&
    typeof value.musicEnabled === "boolean" &&
    typeof value.gameEnabled === "boolean";
}

function isV2Selection(value: unknown): value is Pick<EnvironmentActionSettingsSelection, "musicEnabled" | "gameEnabled"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const selection = value as Partial<EnvironmentActionSettingsSelection>;
  return typeof selection.musicEnabled === "boolean" && typeof selection.gameEnabled === "boolean";
}

function hasV2SettingsValues(value: EnvironmentActionSettingsRecordInput): value is Pick<EnvironmentActionSettings, "musicEnabled" | "gameEnabled"> & EnvironmentActionSettingsRecordInput {
  return typeof value.musicEnabled === "boolean" && typeof value.gameEnabled === "boolean";
}

function readSelectedValue(value: unknown, selected: boolean): boolean {
  if (!selected) {
    return true;
  }
  return typeof value === "boolean" ? value : true;
}
