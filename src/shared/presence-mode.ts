export type PresenceModeId = "default" | "focus" | "quiet" | "sleep";

export type PresenceModeView = {
  id: PresenceModeId;
  label: string;
  description: string;
};

export const DEFAULT_PRESENCE_MODE_ID: PresenceModeId = "default";

export const PRESENCE_MODE_LABELS: Readonly<Record<PresenceModeId, string>> = {
  default: "默认陪伴",
  focus: "专注陪伴",
  quiet: "安静陪伴",
  sleep: "睡眠待机"
};

export const PRESENCE_MODE_DESCRIPTIONS: Readonly<Record<PresenceModeId, string>> = {
  default: "保留日常呼吸与动作节奏。",
  focus: "降低待机打扰，保留清晰回应。",
  quiet: "减少强动作与空闲渲染。",
  sleep: "低频待机，保留微弱生命感。"
};

export const PRESENCE_MODE_VIEWS: readonly PresenceModeView[] = [
  { id: "default", label: PRESENCE_MODE_LABELS.default, description: PRESENCE_MODE_DESCRIPTIONS.default },
  { id: "focus", label: PRESENCE_MODE_LABELS.focus, description: PRESENCE_MODE_DESCRIPTIONS.focus },
  { id: "quiet", label: PRESENCE_MODE_LABELS.quiet, description: PRESENCE_MODE_DESCRIPTIONS.quiet },
  { id: "sleep", label: PRESENCE_MODE_LABELS.sleep, description: PRESENCE_MODE_DESCRIPTIONS.sleep }
];

export function isPresenceModeId(value: unknown): value is PresenceModeId {
  return value === "default" || value === "focus" || value === "quiet" || value === "sleep";
}

export function parsePresenceModeId(value: unknown): PresenceModeId | null {
  return isPresenceModeId(value) ? value : null;
}

export function getPresenceModeLabel(modeId: PresenceModeId): string {
  return PRESENCE_MODE_LABELS[modeId];
}
