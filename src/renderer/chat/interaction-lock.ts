export const REPLY_LOCKED_CONTROL_IDS = [
  "chat-input",
  "send-button",
  "settings-button",
  "chat-tab",
  "history-tab",
  "memory-tab",
  "new-conversation-button",
  "clear-history-button",
  "enable-memory-button",
  "clear-memory-button",
  "save-memory-draft-button",
  "save-user-profile-button",
  "clear-user-profile-button",
  "welcome-save-user-profile-button",
  "shelf-accessory-button",
  "shelf-scale-button",
  "shelf-lock-button"
] as const;

export const REPLY_UNLOCKED_CONTROL_IDS = [
  "abort-button"
] as const;

export const REPLY_LOCKED_CONTROL_GROUPS = [
  "dialogue-mode-buttons",
  "presence-mode-buttons",
  "history-detail-buttons",
  "settings-form-controls"
] as const;

export type ReplyLockedControlId = typeof REPLY_LOCKED_CONTROL_IDS[number];
export type ReplyUnlockedControlId = typeof REPLY_UNLOCKED_CONTROL_IDS[number];
export type ReplyLockControlId = ReplyLockedControlId | ReplyUnlockedControlId;
export type ReplyLockedControlGroup = typeof REPLY_LOCKED_CONTROL_GROUPS[number];

export type ReplyLockControlState = {
  controlId: ReplyLockControlId;
  disabled: boolean;
};

export type ReplyLockState = {
  controls: ReplyLockControlState[];
  disabledGroups: readonly ReplyLockedControlGroup[];
  groupsDisabled: boolean;
};

export function createReplyInteractionLockState(isReplying: boolean): ReplyLockState {
  return {
    controls: [
      ...REPLY_LOCKED_CONTROL_IDS.map((controlId) => ({ controlId, disabled: isReplying })),
      ...REPLY_UNLOCKED_CONTROL_IDS.map((controlId) => ({ controlId, disabled: !isReplying }))
    ],
    disabledGroups: REPLY_LOCKED_CONTROL_GROUPS,
    groupsDisabled: isReplying
  };
}
