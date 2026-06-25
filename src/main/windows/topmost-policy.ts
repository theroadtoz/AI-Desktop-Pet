export type TopmostWindowLevel =
  | "normal"
  | "floating"
  | "torn-off-menu"
  | "modal-panel"
  | "main-menu"
  | "status"
  | "pop-up-menu"
  | "screen-saver"
  | "dock";

export const TOPMOST_WINDOW_LEVEL: TopmostWindowLevel = "screen-saver";

type PetWindowTarget = {
  isDestroyed(): boolean;
  isVisible(): boolean;
  setAlwaysOnTop(flag: boolean, level: TopmostWindowLevel): void;
  showInactive(): void;
  moveTop(): void;
};

type ChatWindowTarget = {
  isMinimized(): boolean;
  restore(): void;
  setAlwaysOnTop(flag: boolean, level: TopmostWindowLevel): void;
  show(): void;
  moveTop(): void;
  focus(): void;
};

export function restorePetWindowOnTop(window: PetWindowTarget): void {
  if (window.isDestroyed()) {
    return;
  }

  window.setAlwaysOnTop(true, TOPMOST_WINDOW_LEVEL);

  if (!window.isVisible()) {
    window.showInactive();
  }

  window.moveTop();
}

export function showChatWindowAbovePet(window: ChatWindowTarget): void {
  if (window.isMinimized()) {
    window.restore();
  }

  window.setAlwaysOnTop(true, TOPMOST_WINDOW_LEVEL);
  window.show();
  window.moveTop();
  window.focus();
}
