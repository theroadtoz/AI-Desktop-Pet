import type { Live2DFrameSample } from "./live2d/types";

type Live2DFrameSampleWaiterOptions = {
  scheduleTimeout: (callback: () => void, delayMs: number) => number;
  clearScheduledTimeout: (handle: number) => void;
};

type PendingWaiter = {
  resolve: (sample: Live2DFrameSample | null) => void;
  timeoutHandle: number;
};

export type Live2DFrameSampleWaiters = {
  waitForNextFrame(timeoutMs?: number): Promise<Live2DFrameSample | null>;
  resolveFrame(sample: Live2DFrameSample): void;
  cancelPending(): void;
  dispose(): void;
  getPendingCount(): number;
};

export function createLive2DFrameSampleWaiters({
  scheduleTimeout,
  clearScheduledTimeout
}: Live2DFrameSampleWaiterOptions): Live2DFrameSampleWaiters {
  const pending = new Map<number, PendingWaiter>();
  let nextId = 1;
  let disposed = false;

  function settle(id: number, sample: Live2DFrameSample | null): void {
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    clearScheduledTimeout(waiter.timeoutHandle);
    waiter.resolve(sample);
  }

  return {
    waitForNextFrame(timeoutMs = 2_000) {
      if (disposed) return Promise.resolve(null);

      return new Promise((resolve) => {
        const id = nextId++;
        const timeoutHandle = scheduleTimeout(() => settle(id, null), timeoutMs);
        pending.set(id, { resolve, timeoutHandle });
      });
    },
    resolveFrame(sample) {
      for (const id of [...pending.keys()]) settle(id, sample);
    },
    cancelPending() {
      for (const id of [...pending.keys()]) settle(id, null);
    },
    dispose() {
      disposed = true;
      for (const id of [...pending.keys()]) settle(id, null);
    },
    getPendingCount() {
      return pending.size;
    }
  };
}
