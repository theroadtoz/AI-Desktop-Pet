import {
  DEFAULT_SHORTCUT_PREFERENCES,
  TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID,
  USER_SHORTCUT_ACTIONS,
  createShortcutPreferenceView,
  getShortcutAccelerator,
  mergeShortcutPreferencesWithDefaults,
  resetShortcutPreference,
  updateShortcutPreference,
  type ShortcutActionId,
  type ShortcutPreferenceView,
  type ShortcutPreferences,
  type ShortcutUpdateResult
} from "../../shared/shortcut-preferences";

export type ShortcutRegistrationResult = {
  accelerator: string;
  registered: boolean;
  reason: "registered" | "already_registered" | "unavailable";
};

export type ShortcutRegistry = {
  getPreferences(): ShortcutPreferences;
  getShortcutViews(): ShortcutPreferenceView[];
  registerAll(preferences?: ShortcutPreferences): ShortcutRegistrationResult[];
  updateShortcut(actionId: unknown, accelerator: unknown): ShortcutUpdateResult;
  resetShortcut(actionId: unknown): ShortcutUpdateResult;
  unregisterAll(): void;
};

export function createShortcutRegistry(options: {
  initialPreferences?: ShortcutPreferences;
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
  isRegistered?: (accelerator: string) => boolean;
  savePreferences: (preferences: ShortcutPreferences) => ShortcutPreferences;
  handlers: Partial<Record<ShortcutActionId, () => void>>;
  onRegistrationResult?: (result: ShortcutRegistrationResult & { actionId: ShortcutActionId }) => void;
  onPreferencesChanged?: (preferences: ShortcutPreferences) => void;
}): ShortcutRegistry {
  const initialPreferences = mergeShortcutPreferencesWithDefaults(options.initialPreferences ?? DEFAULT_SHORTCUT_PREFERENCES);
  let currentPreferences = initialPreferences.ok ? initialPreferences.preferences : DEFAULT_SHORTCUT_PREFERENCES;
  const registeredAccelerators = new Map<ShortcutActionId, string>();

  function registerAction(actionId: ShortcutActionId, accelerator: string): ShortcutRegistrationResult {
    const previousAccelerator = registeredAccelerators.get(actionId);

    if (previousAccelerator === accelerator && (options.isRegistered?.(accelerator) ?? true)) {
      return {
        accelerator,
        registered: true,
        reason: "already_registered"
      };
    }

    if (previousAccelerator && previousAccelerator !== accelerator) {
      options.unregister(previousAccelerator);
      registeredAccelerators.delete(actionId);
    }

    const handler = options.handlers[actionId];

    if (!handler) {
      return {
        accelerator,
        registered: false,
        reason: "unavailable"
      };
    }

    const registered = options.register(accelerator, handler);

    if (registered) {
      registeredAccelerators.set(actionId, accelerator);
    }

    return {
      accelerator,
      registered,
      reason: registered ? "registered" : "unavailable"
    };
  }

  function emitRegistration(actionId: ShortcutActionId, result: ShortcutRegistrationResult): void {
    options.onRegistrationResult?.({
      ...result,
      actionId
    });
  }

  function registerPreferences(preferences: ShortcutPreferences): ShortcutRegistrationResult[] {
    const results: ShortcutRegistrationResult[] = [];

    for (const action of USER_SHORTCUT_ACTIONS.filter((item) => item.kind === "global")) {
      const accelerator = getShortcutAccelerator(preferences, action.id);
      const result = registerAction(action.id, accelerator);

      emitRegistration(action.id, result);
      results.push(result);
    }

    return results;
  }

  function makeResult(ok: boolean, reason?: string): ShortcutUpdateResult {
    return ok
      ? {
        ok: true,
        preferences: currentPreferences,
        shortcuts: createShortcutPreferenceView(currentPreferences)
      }
      : {
        ok: false,
        reason: reason ?? "快捷键保存失败。",
        preferences: currentPreferences,
        shortcuts: createShortcutPreferenceView(currentPreferences)
      };
  }

  function applyPreferences(nextPreferences: ShortcutPreferences, changedActionId: ShortcutActionId): ShortcutUpdateResult {
    const previousPreferences = currentPreferences;
    const previousAccelerator = registeredAccelerators.get(TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID);
    const nextAccelerator = getShortcutAccelerator(nextPreferences, TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID);

    if (changedActionId !== TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID) {
      try {
        currentPreferences = options.savePreferences(nextPreferences);
        options.onPreferencesChanged?.(currentPreferences);
        return makeResult(true);
      } catch {
        currentPreferences = previousPreferences;
        return makeResult(false, "快捷键配置写入失败，已保留原快捷键。");
      }
    }

    if (previousAccelerator && previousAccelerator !== nextAccelerator) {
      options.unregister(previousAccelerator);
      registeredAccelerators.delete(TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID);
    }

    const registration = registerAction(TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID, nextAccelerator);
    emitRegistration(TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID, registration);

    if (!registration.registered) {
      if (previousAccelerator && previousAccelerator !== nextAccelerator) {
        const rollback = registerAction(TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID, previousAccelerator);
        emitRegistration(TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID, rollback);
      }

      currentPreferences = previousPreferences;
      return makeResult(false, "系统未能注册该快捷键，请换一个组合。");
    }

    try {
      currentPreferences = options.savePreferences(nextPreferences);
      options.onPreferencesChanged?.(currentPreferences);
      return makeResult(true);
    } catch {
      if (previousAccelerator !== nextAccelerator) {
        options.unregister(nextAccelerator);
        registeredAccelerators.delete(TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID);
      }

      if (previousAccelerator && previousAccelerator !== nextAccelerator) {
        const rollback = registerAction(TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID, previousAccelerator);
        emitRegistration(TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID, rollback);
      }

      currentPreferences = previousPreferences;
      return makeResult(false, "快捷键配置写入失败，已保留原快捷键。");
    }
  }

  return {
    getPreferences() {
      return currentPreferences;
    },
    getShortcutViews() {
      return createShortcutPreferenceView(currentPreferences);
    },
    registerAll(preferences = currentPreferences) {
      const merged = mergeShortcutPreferencesWithDefaults(preferences);
      currentPreferences = merged.ok ? merged.preferences : DEFAULT_SHORTCUT_PREFERENCES;
      options.onPreferencesChanged?.(currentPreferences);
      return registerPreferences(currentPreferences);
    },
    updateShortcut(actionId, accelerator) {
      const nextPreferences = updateShortcutPreference(currentPreferences, actionId, accelerator);

      if (!nextPreferences.ok) {
        return makeResult(false, nextPreferences.reason);
      }

      return applyPreferences(nextPreferences.preferences, actionId as ShortcutActionId);
    },
    resetShortcut(actionId) {
      const nextPreferences = resetShortcutPreference(currentPreferences, actionId);

      if (!nextPreferences.ok) {
        return makeResult(false, nextPreferences.reason);
      }

      return applyPreferences(nextPreferences.preferences, actionId as ShortcutActionId);
    },
    unregisterAll() {
      for (const accelerator of registeredAccelerators.values()) {
        options.unregister(accelerator);
      }

      registeredAccelerators.clear();
    }
  };
}
