import { CURIOUS_FOCUS_PULSE_PROFILE } from "./p2-88d-curious-low-preview-profile.ts";

export type CuriousFocusPulsePreviewController = {
  isActive(): boolean;
  start(): boolean;
  release(): void;
  cancelForOwnershipLoss(): void;
  dispose(): void;
};

export type CuriousFocusPulsePreviewStatus =
  | "idle"
  | "active"
  | "blocked-owner"
  | "blocked-recovery"
  | "blocked-repeat"
  | "released"
  | "disposed";

export type CuriousFocusPulsePreviewControllerOptions = {
  isLive2D(): boolean;
  isInteractionActionActive(): boolean;
  isRecoveringContext(): boolean;
  setLookTarget(x: number, y: number): void;
  releaseLookTarget(): void;
  scheduleTimeout(callback: () => void, delayMs: number): unknown;
  clearScheduledTimeout(handle: unknown): void;
  reportStatus?(status: CuriousFocusPulsePreviewStatus): void;
};

export function createCuriousFocusPulsePreviewController(
  options: CuriousFocusPulsePreviewControllerOptions
): CuriousFocusPulsePreviewController {
  let active = false;
  let timers: unknown[] = [];
  const reportStatus = options.reportStatus ?? (() => undefined);
  reportStatus("idle");

  function clear(): boolean {
    if (!active) {
      return false;
    }
    for (const timer of timers) {
      options.clearScheduledTimeout(timer);
    }
    timers = [];
    active = false;
    return true;
  }

  function release(): void {
    if (!clear()) {
      return;
    }
    try {
      options.releaseLookTarget();
    } catch {
      // Preview-only cleanup must never propagate into the pet runtime.
    }
    reportStatus("released");
  }

  function cancelForOwnershipLoss(): void {
    clear();
  }

  function apply(point: { x: number; y: number }): void {
    if (!active) {
      return;
    }
    try {
      if (options.isRecoveringContext() || !options.isLive2D() || options.isInteractionActionActive()) {
        cancelForOwnershipLoss();
        return;
      }
      options.setLookTarget(point.x, point.y);
    } catch {
      release();
    }
  }

  return {
    isActive(): boolean {
      return active;
    },
    start(): boolean {
      if (active) {
        reportStatus("blocked-repeat");
        return false;
      }
      try {
        if (options.isRecoveringContext()) {
          reportStatus("blocked-recovery");
          return false;
        }
        if (!options.isLive2D() || options.isInteractionActionActive()) {
          reportStatus("blocked-owner");
          return false;
        }
      } catch {
        reportStatus("blocked-owner");
        return false;
      }

      active = true;
      reportStatus("active");
      try {
        const initial = CURIOUS_FOCUS_PULSE_PROFILE.lookTarget[0]!;
        const focus = CURIOUS_FOCUS_PULSE_PROFILE.lookTarget[1]!;
        const settle = CURIOUS_FOCUS_PULSE_PROFILE.lookTarget[2]!;
        options.setLookTarget(initial.x, initial.y);
        timers = [
          options.scheduleTimeout(() => apply(focus), focus.atMs),
          options.scheduleTimeout(() => apply(settle), settle.atMs),
          options.scheduleTimeout(release, CURIOUS_FOCUS_PULSE_PROFILE.durationMs)
        ];
        return true;
      } catch {
        release();
        return false;
      }
    },
    release,
    cancelForOwnershipLoss,
    dispose(): void {
      release();
      reportStatus("disposed");
    }
  };
}
