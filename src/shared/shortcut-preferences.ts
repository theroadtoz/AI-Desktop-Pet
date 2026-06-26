export const TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID = "togglePetLock" as const;
export const ADJUST_PET_SCALE_WITH_WHEEL_SHORTCUT_ACTION_ID = "adjustPetScaleWithWheel" as const;
export const DEFAULT_TOGGLE_PET_LOCK_ACCELERATOR = "Tab+0";
export const DEFAULT_SCALE_WHEEL_MODIFIER_ACCELERATOR = "Ctrl+Shift";
export const WEBGL_DIAGNOSTIC_ACCELERATOR = "Ctrl+Alt+Shift+L";

export const shortcutActionIds = [
  TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID,
  ADJUST_PET_SCALE_WITH_WHEEL_SHORTCUT_ACTION_ID
] as const;

export type ShortcutActionId = typeof shortcutActionIds[number];
export type ShortcutActionKind = "global" | "wheelModifier";

export type ShortcutActionDefinition = {
  id: ShortcutActionId;
  label: string;
  description: string;
  defaultAccelerator: string;
  kind: ShortcutActionKind;
  scope: "global" | "petRenderer";
  canDisable: boolean;
  userConfigurable: boolean;
};

export type ShortcutActionPreference = {
  actionId: ShortcutActionId;
  accelerator: string;
};

export type ShortcutPreferences = {
  shortcuts: ShortcutActionPreference[];
};

export type ShortcutPreferenceView = ShortcutActionDefinition & {
  accelerator: string;
  isDefault: boolean;
};

export type ShortcutValidationResult =
  | { ok: true; preferences: ShortcutPreferences }
  | { ok: false; reason: string };

export type ShortcutUpdateResult =
  | { ok: true; preferences: ShortcutPreferences; shortcuts: ShortcutPreferenceView[] }
  | { ok: false; reason: string; preferences: ShortcutPreferences; shortcuts: ShortcutPreferenceView[] };

export const USER_SHORTCUT_ACTIONS: ShortcutActionDefinition[] = [
  {
    id: TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID,
    label: "切换桌宠锁定",
    description: "锁定或解除锁定桌宠，并切换点击穿透。",
    defaultAccelerator: DEFAULT_TOGGLE_PET_LOCK_ACCELERATOR,
    kind: "global",
    scope: "global",
    canDisable: false,
    userConfigurable: true
  },
  {
    id: ADJUST_PET_SCALE_WITH_WHEEL_SHORTCUT_ACTION_ID,
    label: "滚轮调整桌宠大小",
    description: "按住修饰键后滚动鼠标滚轮，调整桌宠大小。",
    defaultAccelerator: DEFAULT_SCALE_WHEEL_MODIFIER_ACCELERATOR,
    kind: "wheelModifier",
    scope: "petRenderer",
    canDisable: false,
    userConfigurable: true
  }
];

const knownActionIds = new Set<ShortcutActionId>(shortcutActionIds);
const modifierKeys = new Set(["CommandOrControl", "Ctrl", "Control", "Command", "Cmd", "Alt", "Option", "Shift", "Super", "Meta"]);
const wheelModifierOrder = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const bareBlockedKeys = new Set(["Tab", "Space", "Enter", "Escape", "Esc", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown"]);

export const DEFAULT_SHORTCUT_PREFERENCES: ShortcutPreferences = {
  shortcuts: USER_SHORTCUT_ACTIONS.map((action) => ({
    actionId: action.id,
    accelerator: action.defaultAccelerator
  }))
};

export function isShortcutActionId(value: unknown): value is ShortcutActionId {
  return typeof value === "string" && knownActionIds.has(value as ShortcutActionId);
}

export function normalizeShortcutAccelerator(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  return parts.join("+");
}

export function getShortcutActionDefinition(actionId: ShortcutActionId): ShortcutActionDefinition {
  const action = USER_SHORTCUT_ACTIONS.find((item) => item.id === actionId);

  if (!action) {
    throw new Error(`Unknown shortcut action: ${actionId}`);
  }

  return action;
}

export function getShortcutAccelerator(preferences: ShortcutPreferences, actionId: ShortcutActionId): string {
  return preferences.shortcuts.find((shortcut) => shortcut.actionId === actionId)?.accelerator
    ?? getShortcutActionDefinition(actionId).defaultAccelerator;
}

export function getScaleWheelModifierAccelerator(preferences: ShortcutPreferences): string {
  return getShortcutAccelerator(preferences, ADJUST_PET_SCALE_WITH_WHEEL_SHORTCUT_ACTION_ID);
}

export function createShortcutPreferenceView(preferences: ShortcutPreferences): ShortcutPreferenceView[] {
  return USER_SHORTCUT_ACTIONS
    .filter((action) => action.userConfigurable)
    .map((action) => {
      const accelerator = getShortcutAccelerator(preferences, action.id);

      return {
        ...action,
        accelerator,
        isDefault: accelerator === action.defaultAccelerator
      };
    });
}

function normalizeModifierKey(part: string): string | null {
  if (part === "Ctrl" || part === "Control" || part === "CommandOrControl") {
    return "Ctrl";
  }

  if (part === "Alt" || part === "Option") {
    return "Alt";
  }

  if (part === "Shift") {
    return "Shift";
  }

  if (part === "Meta" || part === "Command" || part === "Cmd" || part === "Super") {
    return "Meta";
  }

  return null;
}

function validateWheelModifierAccelerator(accelerator: unknown): { ok: true; accelerator: string } | { ok: false; reason: string } {
  const normalized = normalizeShortcutAccelerator(accelerator);

  if (!normalized) {
    return { ok: false, reason: "滚轮缩放修饰键不能为空。" };
  }

  const parts = normalized.split("+");

  if (parts.some((part) => part.toLowerCase() === "wheel")) {
    return { ok: false, reason: "滚轮缩放只保存修饰键，不需要包含 Wheel。" };
  }

  const modifiers: string[] = [];

  for (const part of parts) {
    const modifier = normalizeModifierKey(part);

    if (!modifier) {
      return { ok: false, reason: "滚轮缩放只能使用 Ctrl、Alt、Shift、Meta 修饰键。" };
    }

    if (!modifiers.includes(modifier)) {
      modifiers.push(modifier);
    }
  }

  if (modifiers.length === 0) {
    return { ok: false, reason: "滚轮缩放至少需要一个修饰键。" };
  }

  const ordered = wheelModifierOrder.filter((modifier) => modifiers.includes(modifier)).join("+");

  if (ordered === "Ctrl+Alt+Shift") {
    return { ok: false, reason: "不能占用开发诊断快捷键的修饰键组合。" };
  }

  return { ok: true, accelerator: ordered };
}

export function validateShortcutAccelerator(
  accelerator: unknown,
  actionId: ShortcutActionId = TOGGLE_PET_LOCK_SHORTCUT_ACTION_ID
): { ok: true; accelerator: string } | { ok: false; reason: string } {
  const action = getShortcutActionDefinition(actionId);

  if (action.kind === "wheelModifier") {
    return validateWheelModifierAccelerator(accelerator);
  }

  const normalized = normalizeShortcutAccelerator(accelerator);

  if (!normalized) {
    return { ok: false, reason: "快捷键不能为空。" };
  }

  const parts = normalized.split("+");
  const key = parts.at(-1);

  if (!key) {
    return { ok: false, reason: "快捷键缺少主键。" };
  }

  if (normalized === DEFAULT_TOGGLE_PET_LOCK_ACCELERATOR) {
    return { ok: true, accelerator: normalized };
  }

  if (parts.slice(0, -1).some((part) => !modifierKeys.has(part))) {
    return { ok: false, reason: "快捷键修饰键无效。" };
  }

  if (modifierKeys.has(key)) {
    return { ok: false, reason: "快捷键不能只包含修饰键。" };
  }

  if (parts.length === 1 && (/^[A-Z0-9]$/i.test(key) || bareBlockedKeys.has(key))) {
    return { ok: false, reason: "不能使用容易截获普通输入的单键快捷键。" };
  }

  if (normalized.toLowerCase() === WEBGL_DIAGNOSTIC_ACCELERATOR.toLowerCase()) {
    return { ok: false, reason: "不能占用开发诊断快捷键。" };
  }

  return { ok: true, accelerator: normalized };
}

export function parseShortcutPreferences(value: unknown): ShortcutPreferences | null {
  const source = value as Partial<ShortcutPreferences> | null;

  if (!source || !Array.isArray(source.shortcuts)) {
    return null;
  }

  const shortcuts: ShortcutActionPreference[] = [];

  for (const item of source.shortcuts) {
    const shortcut = item as Partial<ShortcutActionPreference> | null;

    if (!shortcut || !isShortcutActionId(shortcut.actionId)) {
      return null;
    }

    const validation = validateShortcutAccelerator(shortcut.accelerator, shortcut.actionId);

    if (!validation.ok) {
      return null;
    }

    shortcuts.push({
      actionId: shortcut.actionId,
      accelerator: validation.accelerator
    });
  }

  const merged = mergeShortcutPreferencesWithDefaults({ shortcuts });

  return merged.ok ? merged.preferences : null;
}

export function parseStoredShortcutPreferences(content: string): ShortcutPreferences {
  const parsed = parseShortcutPreferences(JSON.parse(content));

  if (!parsed) {
    throw new Error("Invalid shortcut preferences");
  }

  return parsed;
}

export function mergeShortcutPreferencesWithDefaults(value: ShortcutPreferences): ShortcutValidationResult {
  const seenActions = new Set<ShortcutActionId>();
  const seenAccelerators = new Set<string>();
  const shortcuts: ShortcutActionPreference[] = [];

  for (const action of USER_SHORTCUT_ACTIONS) {
    const stored = value.shortcuts.find((shortcut) => shortcut.actionId === action.id);
    const accelerator = stored?.accelerator ?? action.defaultAccelerator;
    const validation = validateShortcutAccelerator(accelerator, action.id);

    if (!validation.ok) {
      return validation;
    }

    const acceleratorKey = validation.accelerator.toLowerCase();

    if (seenActions.has(action.id)) {
      return { ok: false, reason: "快捷键 action 重复。" };
    }

    if (seenAccelerators.has(acceleratorKey)) {
      return { ok: false, reason: "快捷键与其他用户功能冲突。" };
    }

    seenActions.add(action.id);
    seenAccelerators.add(acceleratorKey);
    shortcuts.push({
      actionId: action.id,
      accelerator: validation.accelerator
    });
  }

  return {
    ok: true,
    preferences: { shortcuts }
  };
}

export function updateShortcutPreference(
  currentPreferences: ShortcutPreferences,
  actionId: unknown,
  accelerator: unknown
): ShortcutValidationResult {
  if (!isShortcutActionId(actionId)) {
    return { ok: false, reason: "未知快捷键动作。" };
  }

  const validation = validateShortcutAccelerator(accelerator, actionId);

  if (!validation.ok) {
    return validation;
  }

  const nextPreferences: ShortcutPreferences = {
    shortcuts: currentPreferences.shortcuts.map((shortcut) => (
      shortcut.actionId === actionId
        ? { ...shortcut, accelerator: validation.accelerator }
        : shortcut
    ))
  };

  return mergeShortcutPreferencesWithDefaults(nextPreferences);
}

export function resetShortcutPreference(
  currentPreferences: ShortcutPreferences,
  actionId: unknown
): ShortcutValidationResult {
  if (!isShortcutActionId(actionId)) {
    return { ok: false, reason: "未知快捷键动作。" };
  }

  return updateShortcutPreference(
    currentPreferences,
    actionId,
    getShortcutActionDefinition(actionId).defaultAccelerator
  );
}
