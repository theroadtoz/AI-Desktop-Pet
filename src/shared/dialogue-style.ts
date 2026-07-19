import type { AutomaticConversationContextId } from "./automatic-situation-context";

/** @deprecated Internal compatibility alias. Automatic situation owns this value. */
export type DialogueModeId = AutomaticConversationContextId;

export type DialogueStyleContext = {
  modeId: DialogueModeId;
  styleId: "gentle-desktop-companion-v1";
};

export type DialogueModeView = {
  id: DialogueModeId;
  label: string;
};

export const DEFAULT_DIALOGUE_MODE_ID: DialogueModeId = "default";

export const DIALOGUE_MODE_LABELS: Readonly<Record<DialogueModeId, string>> = {
  default: "默认陪伴",
  work: "工作",
  game: "游戏",
  reading: "读书"
};

export const DIALOGUE_MODE_VIEWS: readonly DialogueModeView[] = [
  { id: "default", label: DIALOGUE_MODE_LABELS.default },
  { id: "work", label: DIALOGUE_MODE_LABELS.work },
  { id: "game", label: DIALOGUE_MODE_LABELS.game },
  { id: "reading", label: DIALOGUE_MODE_LABELS.reading }
];

export function isDialogueModeId(value: unknown): value is DialogueModeId {
  return (
    value === "default" ||
    value === "work" ||
    value === "game" ||
    value === "reading"
  );
}

export function parseDialogueModeId(value: unknown): DialogueModeId | null {
  return isDialogueModeId(value) ? value : null;
}

export function getDialogueModeLabel(modeId: DialogueModeId): string {
  return DIALOGUE_MODE_LABELS[modeId];
}
