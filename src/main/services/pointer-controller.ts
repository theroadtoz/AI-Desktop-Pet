import { screen, type BrowserWindow } from "electron";
import type { PetDragDelta } from "../../shared/ipc-contract";

const RESTORE_DELAY_MS = 60;
const POINTER_POLL_INTERVAL_MS = 50;

const HIT_RECTS = [
  { left: 0.25, right: 0.75, top: 0.05, bottom: 0.33 },
  { left: 0.22, right: 0.78, top: 0.28, bottom: 0.83 }
] as const;

export type PointerController = {
  setPointerHit(isHit: boolean): void;
  startDrag(): void;
  moveDrag(delta: PetDragDelta): void;
  endDrag(): void;
  dispose(): void;
};

export function createPointerController(window: BrowserWindow): PointerController {
  let isPointerHit = false;
  let isDragging = false;
  let restoreTimer: NodeJS.Timeout | null = null;
  let pollTimer: NodeJS.Timeout | null = null;

  function clearRestoreTimer(): void {
    if (restoreTimer) {
      clearTimeout(restoreTimer);
      restoreTimer = null;
    }
  }

  function setInteractive(): void {
    clearRestoreTimer();
    if (!window.isDestroyed()) {
      window.setIgnoreMouseEvents(false);
    }
  }

  function setPassThrough(): void {
    if (!window.isDestroyed()) {
      window.setIgnoreMouseEvents(true, { forward: true });
    }
  }

  function schedulePassThrough(): void {
    clearRestoreTimer();
    restoreTimer = setTimeout(() => {
      restoreTimer = null;
      if (!isPointerHit && !isDragging) {
        setPassThrough();
      }
    }, RESTORE_DELAY_MS);
  }

  function isCursorInHitRect(): boolean {
    if (window.isDestroyed()) {
      return false;
    }

    const cursor = screen.getCursorScreenPoint();
    const bounds = window.getBounds();
    const x = (cursor.x - bounds.x) / bounds.width;
    const y = (cursor.y - bounds.y) / bounds.height;

    return HIT_RECTS.some((hitRect) => (
      x >= hitRect.left &&
      x <= hitRect.right &&
      y >= hitRect.top &&
      y <= hitRect.bottom
    ));
  }

  function setPointerHit(nextIsHit: boolean): void {
    isPointerHit = nextIsHit;

    if (isPointerHit || isDragging) {
      setInteractive();
      return;
    }

    schedulePassThrough();
  }

  pollTimer = setInterval(() => {
    const nextIsHit = isCursorInHitRect();

    if (nextIsHit !== isPointerHit) {
      setPointerHit(nextIsHit);
    }
  }, POINTER_POLL_INTERVAL_MS);

  return {
    setPointerHit,
    startDrag() {
      isDragging = true;
      setInteractive();
    },
    moveDrag(delta: PetDragDelta) {
      if (!isDragging || window.isDestroyed()) {
        return;
      }

      const position = window.getPosition();
      const x = position[0] ?? 0;
      const y = position[1] ?? 0;
      window.setPosition(
        Math.round(x + delta.deltaX),
        Math.round(y + delta.deltaY)
      );
    },
    endDrag() {
      isDragging = false;

      if (isPointerHit) {
        setInteractive();
        return;
      }

      schedulePassThrough();
    },
    dispose() {
      clearRestoreTimer();
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }
  };
}
