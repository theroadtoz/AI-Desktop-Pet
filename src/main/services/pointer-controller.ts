import type { BrowserWindow } from "electron";
import type { PetDragDelta } from "../../shared/ipc-contract";

const RESTORE_DELAY_MS = 60;

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

  return {
    setPointerHit(nextIsHit: boolean) {
      isPointerHit = nextIsHit;

      if (isPointerHit || isDragging) {
        setInteractive();
        return;
      }

      schedulePassThrough();
    },
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
    }
  };
}
