import assert from "node:assert/strict";
import test from "node:test";
import {
  createAppShutdownCoordinator,
  shouldHideChatWindowOnClose
} from "../src/main/lifecycle/app-shutdown-coordinator.ts";

test("ordinary chat close hides while quiescing allows the window to close", async () => {
  const coordinator = createAppShutdownCoordinator({
    quiesce() {},
    async stopAsyncResources() {},
    destroyWindows() {},
    finalQuit() {}
  });

  assert.equal(shouldHideChatWindowOnClose(coordinator.isQuiescing()), true);

  await coordinator.shutdown();

  assert.equal(shouldHideChatWindowOnClose(coordinator.isQuiescing()), false);
});

test("shutdown runs once, waits for async stops, then destroys windows and quits", async () => {
  const events: string[] = [];
  let releaseStops: (() => void) | undefined;
  let markStopsStarted: (() => void) | undefined;
  const stopsStarted = new Promise<void>((resolve) => {
    markStopsStarted = resolve;
  });
  const stopsFinished = new Promise<void>((resolve) => {
    releaseStops = resolve;
  });
  const coordinator = createAppShutdownCoordinator({
    quiesce() {
      events.push("quiesce");
    },
    async stopAsyncResources() {
      events.push("stop:start");
      markStopsStarted?.();
      await stopsFinished;
      events.push("stop:done");
    },
    destroyWindows() {
      events.push("destroy");
    },
    finalQuit() {
      events.push("quit");
    }
  });

  const firstShutdown = coordinator.shutdown();
  const secondShutdown = coordinator.shutdown();

  assert.equal(firstShutdown, secondShutdown);
  await stopsStarted;
  assert.deepEqual(events, ["quiesce", "stop:start"]);

  releaseStops?.();
  await firstShutdown;

  assert.deepEqual(events, ["quiesce", "stop:start", "stop:done", "destroy", "quit"]);
  assert.equal(coordinator.shouldAllowFinalQuit(), true);
});

test("shutdown reports cleanup failures and still reaches final quit", async () => {
  const events: string[] = [];
  const errors: unknown[] = [];
  const coordinator = createAppShutdownCoordinator({
    quiesce() {
      events.push("quiesce");
      throw new Error("quiesce failed");
    },
    async stopAsyncResources() {
      events.push("stop");
      throw new Error("stop failed");
    },
    destroyWindows() {
      events.push("destroy");
    },
    finalQuit() {
      events.push("quit");
    },
    reportError(error) {
      errors.push(error);
    }
  });

  await coordinator.shutdown();

  assert.deepEqual(events, ["quiesce", "stop", "destroy", "quit"]);
  assert.equal(errors.length, 2);
});
