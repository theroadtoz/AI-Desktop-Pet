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
  setLocked(isLocked: boolean): void;
  syncWindowSize(): void;
  isLocked(): boolean;
  startDrag(): void;
  moveDrag(delta: PetDragDelta): void;
  endDrag(): void;
  isDragging(): boolean;
  isIgnoringMouseEvents(): boolean;
  dispose(): void;
};

export function createPointerController(window: BrowserWindow): PointerController {
  let isPointerHit = false;
  let isDragging = false;
  let isLocked = false;
  let isIgnoringMouseEvents = true;
  let dragBounds: Electron.Rectangle | null = null;
  let stableWindowSize = {
    width: window.getBounds().width,
    height: window.getBounds().height
  };
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
      isIgnoringMouseEvents = false;
    }
  }

  function setPassThrough(): void {
    if (!window.isDestroyed()) {
      window.setIgnoreMouseEvents(true, { forward: true });
      isIgnoringMouseEvents = true;
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

  function clampBoundsToWorkArea(bounds: Electron.Rectangle): Electron.Rectangle {
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const maximumX = Math.max(workArea.x, workArea.x + workArea.width - bounds.width);
    const maximumY = Math.max(workArea.y, workArea.y + workArea.height - bounds.height);

    return {
      ...bounds,
      x: Math.min(Math.max(bounds.x, workArea.x), maximumX),
      y: Math.min(Math.max(bounds.y, workArea.y), maximumY)
    };
  }

  function setPointerHit(nextIsHit: boolean): void {
    if (isLocked) {
      setPassThrough();
      return;
    }

    if (isDragging) {
      setInteractive();
      return;
    }

    isPointerHit = nextIsHit;

    if (isPointerHit || isDragging) {
      setInteractive();
      return;
    }

    schedulePassThrough();
  }

  pollTimer = setInterval(() => {
    if (isDragging) {
      return;
    }

    const nextIsHit = isCursorInHitRect();

    if (nextIsHit !== isPointerHit) {
      setPointerHit(nextIsHit);
    }
  }, POINTER_POLL_INTERVAL_MS);

  return {
    setPointerHit,
    syncWindowSize() {
      if (window.isDestroyed()) {
        return;
      }

      const bounds = window.getBounds();
      stableWindowSize = {
        width: bounds.width,
        height: bounds.height
      };
    },
    setLocked(nextIsLocked: boolean) {
      isLocked = nextIsLocked;

      if (isLocked) {
        isDragging = false;
        clearRestoreTimer();
        setPassThrough();
        return;
      }

      if (isPointerHit) {
        setInteractive();
        return;
      }

      setPassThrough();
    },
    isLocked() {
      return isLocked;
    },
    startDrag() {
      if (isLocked) {
        setPassThrough();
        return;
      }

      isDragging = true;
      const bounds = window.getBounds();
      dragBounds = {
        ...bounds,
        width: stableWindowSize.width,
        height: stableWindowSize.height
      };
      setInteractive();
    },
    moveDrag(delta: PetDragDelta) {
      if (isLocked || !isDragging || window.isDestroyed()) {
        return;
      }

      if (!Number.isFinite(delta.deltaX) || !Number.isFinite(delta.deltaY)) {
        return;
      }

      const currentBounds = dragBounds ?? window.getBounds();
      const nextBounds = clampBoundsToWorkArea({
        ...currentBounds,
        width: stableWindowSize.width,
        height: stableWindowSize.height,
        x: Math.round(currentBounds.x + delta.deltaX),
        y: Math.round(currentBounds.y + delta.deltaY)
      });
      dragBounds = nextBounds;
      window.setBounds(nextBounds);
    },
    isIgnoringMouseEvents() {
      return isIgnoringMouseEvents;
    },
    isDragging() {
      return isDragging;
    },
    endDrag() {
      isDragging = false;
      dragBounds = null;

      if (isLocked) {
        setPassThrough();
        return;
      }

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
