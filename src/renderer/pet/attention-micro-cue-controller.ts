import {
  parseAttentionMicroCueCommand,
  type AttentionMicroCueCommand
} from "../../shared/attention-micro-cue.ts";
import { APPROVED_ATTENTION_MICRO_CUE_PROFILE } from "./attention-micro-cue-profile.ts";

export type AttentionMicroCueResultReason =
  | "started"
  | "released"
  | "cancelled"
  | "idle"
  | "invalid-command"
  | "active"
  | "owner-active"
  | "owner-unknown"
  | "safety-unknown"
  | "recovering"
  | "renderer-unavailable"
  | "hidden"
  | "disposed"
  | "failed";

export type AttentionMicroCueResult = Readonly<{
  accepted: boolean;
  reason: AttentionMicroCueResultReason;
}>;

export type AttentionMicroCueController = {
  isActive(): boolean;
  handle(command: AttentionMicroCueCommand | unknown): AttentionMicroCueResult;
  cancelForOwnershipLoss(): void;
  dispose(): void;
};

export type AttentionMicroCueControllerOptions = {
  isRendererStable(): boolean;
  isVisible(): boolean;
  isInteractionActionActive(): boolean;
  isRecoveringContext(): boolean;
  setLookTarget(x: number, y: number): void;
  releaseLookTarget(): void;
  scheduleTimeout(callback: () => void, delayMs: number): unknown;
  clearScheduledTimeout(handle: unknown): void;
  reportResult?(result: AttentionMicroCueResult): void;
};

export function createAttentionMicroCueController(
  options: AttentionMicroCueControllerOptions
): AttentionMicroCueController {
  let active = false;
  let disposed = false;
  let timers: unknown[] = [];
  const reportResult = options.reportResult ?? (() => undefined);

  function result(accepted: boolean, reason: AttentionMicroCueResultReason): AttentionMicroCueResult {
    const value = { accepted, reason };
    reportResult(value);
    return value;
  }

  function clear(releaseLook: boolean): boolean {
    if (!active) return false;
    active = false;
    for (const timer of timers) {
      try {
        options.clearScheduledTimeout(timer);
      } catch {
        // Continue cleanup so one timer implementation cannot retain cue ownership.
      }
    }
    timers = [];
    if (releaseLook) {
      try {
        options.releaseLookTarget();
      } catch {
        // A visual micro-cue must never propagate cleanup failures into the pet runtime.
      }
    }
    return true;
  }

  function cancelForOwnershipLoss(): void {
    if (clear(false)) {
      result(false, "owner-active");
    }
  }

  function apply(point: { x: number; y: number }): void {
    if (!active) return;
    try {
      if (options.isInteractionActionActive()) {
        cancelForOwnershipLoss();
        return;
      }
    } catch {
      if (clear(false)) result(false, "owner-unknown");
      return;
    }

    try {
      if (options.isRecoveringContext()) {
        if (clear(true)) result(false, "recovering");
        return;
      }
      if (!options.isRendererStable()) {
        if (clear(true)) result(false, "renderer-unavailable");
        return;
      }
      if (!options.isVisible()) {
        if (clear(true)) result(false, "hidden");
        return;
      }
    } catch {
      if (clear(false)) result(false, "safety-unknown");
      return;
    }

    try {
      options.setLookTarget(point.x, point.y);
    } catch {
      if (clear(true)) result(false, "failed");
    }
  }

  function start(): AttentionMicroCueResult {
    if (disposed) return result(false, "disposed");
    if (active) return result(false, "active");
    try {
      if (options.isRecoveringContext()) return result(false, "recovering");
      if (!options.isRendererStable()) return result(false, "renderer-unavailable");
      if (!options.isVisible()) return result(false, "hidden");
      if (options.isInteractionActionActive()) return result(false, "owner-active");
    } catch {
      return result(false, "renderer-unavailable");
    }

    active = true;
    try {
      const [initial, focus, settle] = APPROVED_ATTENTION_MICRO_CUE_PROFILE.lookTarget;
      options.setLookTarget(initial!.x, initial!.y);
      timers.push(options.scheduleTimeout(() => apply(focus!), focus!.atMs));
      timers.push(options.scheduleTimeout(() => apply(settle!), settle!.atMs));
      timers.push(options.scheduleTimeout(() => {
        if (clear(true)) result(true, "released");
      }, APPROVED_ATTENTION_MICRO_CUE_PROFILE.durationMs));
      return result(true, "started");
    } catch {
      clear(true);
      return result(false, "failed");
    }
  }

  return {
    isActive: () => active,
    handle(command): AttentionMicroCueResult {
      const parsed = parseAttentionMicroCueCommand(command);
      if (!parsed) return result(false, "invalid-command");
      if (parsed.operation === "start") return start();
      return clear(true) ? result(true, "cancelled") : result(false, "idle");
    },
    cancelForOwnershipLoss,
    dispose(): void {
      clear(true);
      disposed = true;
    }
  };
}
