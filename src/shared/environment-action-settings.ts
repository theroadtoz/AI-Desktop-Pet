export type EnvironmentActionSettings = {
  musicEnabled: boolean;
  gameEnabled: boolean;
};

export type EnvironmentActionSettingsUpdate = Partial<EnvironmentActionSettings>;

export const DEFAULT_ENVIRONMENT_ACTION_SETTINGS: EnvironmentActionSettings = Object.freeze({
  musicEnabled: false,
  gameEnabled: false
});

export function normalizeEnvironmentActionSettings(value: unknown): EnvironmentActionSettings {
  const input = value as Partial<EnvironmentActionSettings> | null;

  return {
    musicEnabled: typeof input?.musicEnabled === "boolean"
      ? input.musicEnabled
      : DEFAULT_ENVIRONMENT_ACTION_SETTINGS.musicEnabled,
    gameEnabled: typeof input?.gameEnabled === "boolean"
      ? input.gameEnabled
      : DEFAULT_ENVIRONMENT_ACTION_SETTINGS.gameEnabled
  };
}

export function cloneEnvironmentActionSettings(
  settings: EnvironmentActionSettings
): EnvironmentActionSettings {
  return { ...settings };
}
