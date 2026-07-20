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

type EnvironmentActionSettingsRecordInput = {
  version?: unknown;
  basicEnabled?: unknown;
  musicEnabled?: unknown;
  explicitGameContextEnabled?: unknown;
  gameEnabled?: unknown;
  userSelected?: unknown;
};

type LegacyEnvironmentActionSettingsSelection = {
  basicEnabled?: unknown;
  musicEnabled?: unknown;
  gameEnabled?: unknown;
};

type V3EnvironmentActionSettingsSelection = {
  basicEnabled: boolean;
  musicEnabled: boolean;
  gameEnabled: boolean;
};

type V2EnvironmentActionSettingsSelection = Pick<
  V3EnvironmentActionSettingsSelection,
  "musicEnabled" | "gameEnabled"
>;

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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultResolution();
  }

  const input = value as EnvironmentActionSettingsRecordInput;
  if (isV4OrFutureVersion(input.version) && hasV4SettingsValues(input) && isV4Selection(input.userSelected)) {
    return {
      settings: {
        basicEnabled: readSelectedValue(input.basicEnabled, input.userSelected.basicEnabled),
        musicEnabled: readSelectedValue(input.musicEnabled, input.userSelected.musicEnabled),
        explicitGameContextEnabled: readSelectedValue(
          input.explicitGameContextEnabled,
          input.userSelected.explicitGameContextEnabled
        )
      },
      userSelected: { ...input.userSelected }
    };
  }

  if (input.version === 3 && hasV3SettingsValues(input) && isV3Selection(input.userSelected)) {
    const selection = input.userSelected;
    return {
      settings: {
        basicEnabled: readSelectedValue(input.basicEnabled, selection.basicEnabled),
        musicEnabled: readSelectedValue(input.musicEnabled, selection.musicEnabled),
        explicitGameContextEnabled: readSelectedValue(input.gameEnabled, selection.gameEnabled)
      },
      userSelected: {
        basicEnabled: selection.basicEnabled,
        musicEnabled: selection.musicEnabled,
        explicitGameContextEnabled: selection.gameEnabled
      }
    };
  }

  if (input.version === 2 && hasV2SettingsValues(input) && isV2Selection(input.userSelected)) {
    const selection = input.userSelected;
    return {
      settings: {
        basicEnabled: true,
        musicEnabled: readSelectedValue(input.musicEnabled, selection.musicEnabled),
        explicitGameContextEnabled: readSelectedValue(input.gameEnabled, selection.gameEnabled)
      },
      userSelected: {
        basicEnabled: false,
        musicEnabled: selection.musicEnabled,
        explicitGameContextEnabled: selection.gameEnabled
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
        explicitGameContextEnabled: false
      },
      userSelected: {
        basicEnabled: true,
        musicEnabled: true,
        explicitGameContextEnabled: true
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
    explicitGameContextEnabled: settings.explicitGameContextEnabled,
    userSelected: { ...userSelected }
  };
}

function createDefaultResolution(): EnvironmentActionSettingsResolution {
  return {
    settings: cloneEnvironmentActionSettings(DEFAULT_ENVIRONMENT_ACTION_SETTINGS),
    userSelected: { ...DEFAULT_USER_SELECTION }
  };
}

function isV4OrFutureVersion(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 4;
}

function isV4Selection(value: unknown): value is EnvironmentActionSettingsSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const selection = value as Partial<EnvironmentActionSettingsSelection>;
  return typeof selection.basicEnabled === "boolean" &&
    typeof selection.musicEnabled === "boolean" &&
    typeof selection.explicitGameContextEnabled === "boolean";
}

function hasV4SettingsValues(
  value: EnvironmentActionSettingsRecordInput
): value is EnvironmentActionSettings & EnvironmentActionSettingsRecordInput {
  return typeof value.basicEnabled === "boolean" &&
    typeof value.musicEnabled === "boolean" &&
    typeof value.explicitGameContextEnabled === "boolean";
}

function isV3Selection(value: unknown): value is V3EnvironmentActionSettingsSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const selection = value as LegacyEnvironmentActionSettingsSelection;
  return typeof selection.basicEnabled === "boolean" &&
    typeof selection.musicEnabled === "boolean" &&
    typeof selection.gameEnabled === "boolean";
}

function hasV3SettingsValues(value: EnvironmentActionSettingsRecordInput): boolean {
  return typeof value.basicEnabled === "boolean" &&
    typeof value.musicEnabled === "boolean" &&
    typeof value.gameEnabled === "boolean";
}

function isV2Selection(
  value: unknown
): value is V2EnvironmentActionSettingsSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const selection = value as LegacyEnvironmentActionSettingsSelection;
  return typeof selection.musicEnabled === "boolean" && typeof selection.gameEnabled === "boolean";
}

function hasV2SettingsValues(value: EnvironmentActionSettingsRecordInput): boolean {
  return typeof value.musicEnabled === "boolean" && typeof value.gameEnabled === "boolean";
}

function readSelectedValue(value: unknown, selected: boolean): boolean {
  if (!selected) {
    return true;
  }
  return typeof value === "boolean" ? value : true;
}
