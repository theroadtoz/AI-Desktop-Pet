import assert from "node:assert/strict";
import test from "node:test";
import { createLive2DFrameSampleWaiters } from "../src/renderer/pet/live2d-frame-sample-waiters.ts";

type ScheduledTimers = {
  callbacks: Map<number, () => void>;
  schedule(callback: () => void, delayMs: number): number;
  clear(handle: number): void;
};

function createScheduledTimers(): ScheduledTimers {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;

  return {
    callbacks,
    schedule(callback) {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    clear(handle) {
      callbacks.delete(handle);
    }
  };
}

const frame = {
  canvasWidth: 420,
  canvasHeight: 600,
  nonTransparentPixels: 1,
  opaqueBlackPixels: 0
};

test("P2-88D-R1 resolves concurrent next-frame observers from the same frame", async () => {
  const timers = createScheduledTimers();
  const waiters = createLive2DFrameSampleWaiters({
    scheduleTimeout: timers.schedule,
    clearScheduledTimeout: timers.clear
  });

  const first = waiters.waitForNextFrame();
  const second = waiters.waitForNextFrame();
  waiters.resolveFrame(frame);

  assert.deepEqual(await Promise.all([first, second]), [frame, frame]);
  assert.equal(waiters.getPendingCount(), 0);
  assert.equal(timers.callbacks.size, 0);
});

test("P2-88D-R1 keeps a later observer pending after an earlier observer times out", async () => {
  const timers = createScheduledTimers();
  const waiters = createLive2DFrameSampleWaiters({
    scheduleTimeout: timers.schedule,
    clearScheduledTimeout: timers.clear
  });

  const first = waiters.waitForNextFrame();
  const second = waiters.waitForNextFrame();
  timers.callbacks.get(1)!();

  assert.equal(await first, null);
  assert.equal(waiters.getPendingCount(), 1);
  waiters.resolveFrame(frame);

  assert.deepEqual(await second, frame);
  assert.equal(waiters.getPendingCount(), 0);
});

test("P2-88D-R1 clears resolved observer timers so a late timeout cannot settle again", async () => {
  const timers = createScheduledTimers();
  const waiters = createLive2DFrameSampleWaiters({
    scheduleTimeout: timers.schedule,
    clearScheduledTimeout: timers.clear
  });

  const nextFrame = waiters.waitForNextFrame();
  const staleTimeout = timers.callbacks.get(1)!;
  waiters.resolveFrame(frame);

  assert.deepEqual(await nextFrame, frame);
  assert.equal(waiters.getPendingCount(), 0);
  assert.equal(timers.callbacks.size, 0);
  staleTimeout();
  assert.equal(waiters.getPendingCount(), 0);
  assert.equal(timers.callbacks.size, 0);
});

test("P2-88D-R1 does not let a later observer consume a historical frame", async () => {
  const timers = createScheduledTimers();
  const waiters = createLive2DFrameSampleWaiters({
    scheduleTimeout: timers.schedule,
    clearScheduledTimeout: timers.clear
  });
  const nextFrame = {
    ...frame,
    nonTransparentPixels: 2
  };

  waiters.resolveFrame(frame);
  const afterHistory = waiters.waitForNextFrame();

  assert.equal(waiters.getPendingCount(), 1);
  waiters.resolveFrame(nextFrame);
  assert.deepEqual(await afterHistory, nextFrame);
  assert.equal(waiters.getPendingCount(), 0);
});

test("P2-88D-R1 disposes every pending observer and clears every timer", async () => {
  const timers = createScheduledTimers();
  const waiters = createLive2DFrameSampleWaiters({
    scheduleTimeout: timers.schedule,
    clearScheduledTimeout: timers.clear
  });

  const first = waiters.waitForNextFrame();
  const second = waiters.waitForNextFrame();
  waiters.dispose();

  assert.deepEqual(await Promise.all([first, second]), [null, null]);
  assert.equal(waiters.getPendingCount(), 0);
  assert.equal(timers.callbacks.size, 0);
  assert.equal(await waiters.waitForNextFrame(), null);
});

test("P2-88D-R1 cancels current observers without closing the next recovery round", async () => {
  const timers = createScheduledTimers();
  const waiters = createLive2DFrameSampleWaiters({
    scheduleTimeout: timers.schedule,
    clearScheduledTimeout: timers.clear
  });

  const staleObserver = waiters.waitForNextFrame();
  waiters.cancelPending();

  assert.equal(await staleObserver, null);
  assert.equal(waiters.getPendingCount(), 0);
  assert.equal(timers.callbacks.size, 0);

  const recoveryObserver = waiters.waitForNextFrame();
  waiters.resolveFrame(frame);
  assert.deepEqual(await recoveryObserver, frame);
});
