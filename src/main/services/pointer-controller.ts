import { screen, type BrowserWindow } from "electron";
import type { PetDragDelta, PetOverlayHitRegion } from "../../shared/ipc-contract";
import { clampPetBounds } from "../../shared/pet-presentation";
import {
  createWindowMotionDetector,
  type WindowMotionTelemetryCandidate
} from "./window-motion-detector";
import { isScreenPointInOverlayHitRegion } from "./overlay-hit-region";

const RESTORE_DELAY_MS = 60;
const POINTER_POLL_INTERVAL_MS = 50;

const HIT_RECTS = [
  { left: 0.25, right: 0.75, top: 0.05, bottom: 0.33 },
  { left: 0.22, right: 0.78, top: 0.28, bottom: 0.83 }
] as const;

export type PointerController = {
  setPointerHit(isHit: boolean): void;
  setOverlayHit(isHit: boolean): void;
  setOverlayHitRegion(region: PetOverlayHitRegion | null): void;
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

export type PointerControllerOptions = {
  getMotionGuards?: () => {
    isScaleGestureActive: boolean;
    isChatInteractionActive: boolean;
  };
  onWindowMotionCandidate?: (candidate: WindowMotionTelemetryCandidate) => void;
  onOverlayRegionHitChanged?: (isHit: boolean) => void;
  nowMs?: () => number;
};

export function createPointerController(
  window: BrowserWindow,
  options: PointerControllerOptions = {}
): PointerController {
  let isPointerHit = false;
  let isOverlayHit = false;
  let isOverlayRegionHit = false;
  let overlayHitRegion: PetOverlayHitRegion | null = null;
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
  const windowMotionDetector = createWindowMotionDetector();

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
      if (!isPointerHit && !isOverlayHit && !isOverlayRegionHit && !isDragging) {
        setPassThrough();
      }
    }, RESTORE_DELAY_MS);
  }

  function isCursorInHitRect(cursor: Electron.Point, bounds: Electron.Rectangle): boolean {
    if (window.isDestroyed()) {
      return false;
    }

    const x = (cursor.x - bounds.x) / bounds.width;
    const y = (cursor.y - bounds.y) / bounds.height;

    return HIT_RECTS.some((hitRect) => (
      x >= hitRect.left &&
      x <= hitRect.right &&
      y >= hitRect.top &&
      y <= hitRect.bottom
    ));
  }

  function setOverlayRegionHit(nextIsHit: boolean): void {
    if (nextIsHit === isOverlayRegionHit) {
      return;
    }
    isOverlayRegionHit = nextIsHit;
    options.onOverlayRegionHitChanged?.(nextIsHit);
    if (isLocked) {
      setPassThrough();
    } else if (isOverlayRegionHit || isOverlayHit || isPointerHit || isDragging) {
      setInteractive();
    } else {
      schedulePassThrough();
    }
  }

  function clampBoundsToWorkArea(bounds: Electron.Rectangle): Electron.Rectangle {
    const workArea = screen.getDisplayMatching(bounds).workArea;
    return clampPetBounds(bounds, workArea);
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

    if (isPointerHit || isOverlayHit || isOverlayRegionHit || isDragging) {
      setInteractive();
      return;
    }

    schedulePassThrough();
  }

  pollTimer = setInterval(() => {
    if (isDragging) {
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const bounds = window.getBounds();
    const nextIsHit = isCursorInHitRect(cursor, bounds);
    setOverlayRegionHit(isScreenPointInOverlayHitRegion(cursor, bounds, overlayHitRegion));

    if (nextIsHit !== isPointerHit) {
      setPointerHit(nextIsHit);
    }
  }, POINTER_POLL_INTERVAL_MS);

  return {
    setPointerHit,
    setOverlayHit(nextIsHit: boolean) {
      if (nextIsHit === isOverlayHit) {
        return;
      }
      isOverlayHit = nextIsHit;
      if (isLocked) {
        setPassThrough();
      } else if (isOverlayHit || isOverlayRegionHit || isPointerHit || isDragging) {
        setInteractive();
      } else {
        schedulePassThrough();
      }
    },
    setOverlayHitRegion(nextRegion: PetOverlayHitRegion | null) {
      overlayHitRegion = nextRegion ? { ...nextRegion } : null;
      if (!overlayHitRegion) {
        setOverlayRegionHit(false);
      }
    },
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

      if (isPointerHit || isOverlayHit || isOverlayRegionHit) {
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

      const motionGuards = options.getMotionGuards?.() ?? {
        isScaleGestureActive: false,
        isChatInteractionActive: false
      };
      const motionCandidate = windowMotionDetector.observe({
        deltaX: delta.deltaX,
        deltaY: delta.deltaY,
        nowMs: options.nowMs?.() ?? Date.now(),
        isLocked,
        isDragging,
        isScaleGestureActive: motionGuards.isScaleGestureActive,
        isChatInteractionActive: motionGuards.isChatInteractionActive
      });

      if (motionCandidate) {
        options.onWindowMotionCandidate?.(motionCandidate);
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

      if (isPointerHit || isOverlayHit || isOverlayRegionHit) {
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
      isOverlayHit = false;
      overlayHitRegion = null;
      if (isOverlayRegionHit) {
        isOverlayRegionHit = false;
        options.onOverlayRegionHitChanged?.(false);
      }
    }
  };
}
