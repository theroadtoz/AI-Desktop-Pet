import assert from "node:assert/strict";
import test from "node:test";
import { runWithRealUiDeadline } from "./support/real-ui-run-deadline.mjs";

test("real-UI deadline clears its referenced timer after a successful run", async () => {
  let timerCallback: (() => void) | null = null;
  let cleared = 0;
  const result = await runWithRealUiDeadline(
    async () => "ok",
    1_000,
    {
      setTimer(callback) {
        timerCallback = callback;
        return { unref() {} };
      },
      clearTimer() {
        cleared += 1;
      }
    }
  );

  assert.equal(result, "ok");
  assert.equal(typeof timerCallback, "function");
  assert.equal(cleared, 1);
});

test("real-UI deadline clears its referenced timer after a failed run", async () => {
  let cleared = 0;
  await assert.rejects(
    runWithRealUiDeadline(
      async () => { throw new Error("run_failed"); },
      1_000,
      {
        setTimer() {
          return { unref() {} };
        },
        clearTimer() {
          cleared += 1;
        }
      }
    ),
    /run_failed/
  );
  assert.equal(cleared, 1);
});
