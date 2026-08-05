import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { EventEmitter } from "node:events";

import {
  CdpClientError,
  RealUiHarnessError,
  TargetDiscoveryError,
  assertRealUiRunParentRemoved,
  cleanupRealUiRun,
  createSafeBodyAttemptResult,
  createRunDeadline,
  createRealUiRunContext,
  getPageByUrlPartWithDependencies,
  runStructuredRealUiAcceptance,
  runBodyActionAcceptance,
  summarizeActionLifecycle,
  startElectron,
  waitForActionLifecycleIdle,
  waitForActionLifecycleResult,
  waitForJsonWithDependencies
} from "./real-ui-harness.mjs";

const BODY_ACTION_TYPES = ["bodyAttentionTurn", "quietNod", "appearance"];

function lifecycleEvent(type: string, actionType: string, terminalStatus?: string, skipReason?: string) {
  return {
    type,
    payload: {
      actionType,
      ...(terminalStatus ? { terminalStatus } : {}),
      ...(skipReason ? { skipReason } : {})
    }
  };
}

function fakeBodyRun(schedule: (attempt: number, events: any[], now: number) => void, timeoutMs = 70_000) {
  let now = 0;
  let attempts = 0;
  const events: any[] = [];
  const progress: any[] = [];
  const run = runBodyActionAcceptance({
    readEvents: () => events,
    trigger: async () => {
      attempts += 1;
      schedule(attempts, events, now);
      return true;
    },
    actionType: "bodyAttentionTurn",
    actionTypes: BODY_ACTION_TYPES,
    deadline: createRunDeadline(timeoutMs, { now: () => now }),
    now: () => now,
    pollMs: 1,
    stableMs: 550,
    sleep: async (ms: number) => {
      now += ms;
      schedule(attempts, events, now);
    },
    onProgress: (result: unknown) => progress.push(result)
  });
  return { run, events, progress, get now() { return now; }, get attempts() { return attempts; } };
}

function createContext() {
  return { port: 9876, pages: [] as any[] };
}

const emptyTargetMetadata = {
  listReadable: false,
  pageTargetCount: 0,
  petTargetCount: 0,
  chatTargetCount: 0,
  otherPageTargetCount: 0,
  invalidTargetCount: 0,
  matchingCandidateCount: 0,
  attemptedCandidateCount: 0,
  attachPhase: null,
  attachFailureKind: null
};

function assertTargetDiscoveryError(error: unknown, code: string, metadata: Record<string, unknown>) {
  assert.equal(error instanceof TargetDiscoveryError, true);
  assert.equal((error as TargetDiscoveryError).code, code);
  assert.deepEqual((error as TargetDiscoveryError).metadata, metadata);
  assert.equal(JSON.stringify(error).includes("secret"), false);
}

const matchingTarget = {
  type: "page",
  url: "file:///E:/Work-26/AI_Desktop_Pet/dist/renderer/pet/index.html",
  webSocketDebuggerUrl: "ws://target.test"
};

test("getPageByUrlPart retries a failed list read while its outer deadline remains", async () => {
  const context = createContext();
  const cdp = { open: async () => undefined, send: async () => undefined };
  let listReads = 0;
  let sleeps = 0;

  const page = await getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
    listTargets: async () => {
      listReads += 1;
      if (listReads === 1) throw new Error("list_temporarily_unavailable");
      return [matchingTarget];
    },
    sleep: async () => { sleeps += 1; },
    now: () => 0,
    createCdp: () => cdp
  });

  assert.equal(listReads, 2);
  assert.equal(sleeps, 1);
  assert.equal(page.cdp, cdp);
  assert.equal(context.pages.length, 1);
});

test("getPageByUrlPart returns the original list error when the outer deadline expires", async () => {
  const context = createContext();
  let now = 0;
  let listReads = 0;

  await assert.rejects(
    getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
      listTargets: async () => {
        listReads += 1;
        throw new Error("list_still_unavailable");
      },
      sleep: async () => { now = 30_000; },
      now: () => now,
      createCdp: () => { throw new Error("must_not_attach"); }
    }),
    (error) => {
      assertTargetDiscoveryError(error, "target_list_unreadable", emptyTargetMetadata);
      return true;
    }
  );
  assert.equal(listReads, 1);
  assert.equal(context.pages.length, 0);
});

test("getPageByUrlPart does not retry after a selected target fails CDP attach", async () => {
  const context = createContext();
  let listReads = 0;
  let sleeps = 0;

  await assert.rejects(
    getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
      listTargets: async () => {
        listReads += 1;
        return [matchingTarget];
      },
      sleep: async () => { sleeps += 1; },
      now: () => 0,
      createCdp: () => ({
        open: async () => { throw new Error("cdp_attach_failed"); },
        send: async () => undefined
      })
    }),
    (error) => {
      assertTargetDiscoveryError(error, "cdp_attach_failed", {
        listReadable: true,
        pageTargetCount: 1,
        petTargetCount: 1,
        chatTargetCount: 0,
        otherPageTargetCount: 0,
        invalidTargetCount: 0,
        matchingCandidateCount: 1,
        attemptedCandidateCount: 1,
        attachPhase: "open",
        attachFailureKind: "unknown"
      });
      return true;
    }
  );
  assert.equal(listReads, 1);
  assert.equal(sleeps, 0);
  assert.equal(context.pages.length, 0);
});

test("getPageByUrlPart tries the next matching target from the same list after open fails", async () => {
  const context = createContext();
  const firstTarget = { ...matchingTarget, webSocketDebuggerUrl: "ws://first.test" };
  const secondTarget = { ...matchingTarget, webSocketDebuggerUrl: "ws://second.test" };
  let firstClosed = false;
  const page = await getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
    listTargets: async () => [firstTarget, secondTarget],
    sleep: async () => { throw new Error("must_not_retry_target_list"); },
    now: () => 0,
    createCdp: (webSocketDebuggerUrl) => webSocketDebuggerUrl === firstTarget.webSocketDebuggerUrl
      ? {
        open: async () => { throw new CdpClientError("session_closed"); },
        send: async () => { throw new Error("must_not_send"); },
        close: () => { firstClosed = true; }
      }
      : {
        open: async () => undefined,
        send: async () => undefined,
        close: () => undefined
      }
  });

  assert.equal(page.target, secondTarget);
  assert.equal(firstClosed, true);
  assert.equal(context.pages.length, 1);
});

test("getPageByUrlPart closes a runtime-enable failure before trying the next matching target", async () => {
  const context = createContext();
  const firstTarget = { ...matchingTarget, webSocketDebuggerUrl: "ws://runtime-first.test" };
  const secondTarget = { ...matchingTarget, webSocketDebuggerUrl: "ws://runtime-second.test" };
  const firstMethods: string[] = [];
  let firstClosed = false;
  const page = await getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
    listTargets: async () => [firstTarget, secondTarget],
    sleep: async () => { throw new Error("must_not_retry_target_list"); },
    now: () => 0,
    createCdp: (webSocketDebuggerUrl) => webSocketDebuggerUrl === firstTarget.webSocketDebuggerUrl
      ? {
        open: async () => undefined,
        send: async (method: string) => {
          firstMethods.push(method);
          throw new CdpClientError("session_closed");
        },
        close: () => { firstClosed = true; }
      }
      : {
        open: async () => undefined,
        send: async () => undefined,
        close: () => undefined
      }
  });

  assert.equal(page.target, secondTarget);
  assert.deepEqual(firstMethods, ["Runtime.enable"]);
  assert.equal(firstClosed, true);
});

test("getPageByUrlPart closes a page-enable failure before trying the next matching target", async () => {
  const context = createContext();
  const firstTarget = { ...matchingTarget, webSocketDebuggerUrl: "ws://page-first.test" };
  const secondTarget = { ...matchingTarget, webSocketDebuggerUrl: "ws://page-second.test" };
  const firstMethods: string[] = [];
  let firstClosed = false;
  const page = await getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
    listTargets: async () => [firstTarget, secondTarget],
    sleep: async () => { throw new Error("must_not_retry_target_list"); },
    now: () => 0,
    createCdp: (webSocketDebuggerUrl) => webSocketDebuggerUrl === firstTarget.webSocketDebuggerUrl
      ? {
        open: async () => undefined,
        send: async (method: string) => {
          firstMethods.push(method);
          if (method === "Page.enable") throw new CdpClientError("session_closed");
        },
        close: () => { firstClosed = true; }
      }
      : {
        open: async () => undefined,
        send: async () => undefined,
        close: () => undefined
      }
  });

  assert.equal(page.target, secondTarget);
  assert.deepEqual(firstMethods, ["Runtime.enable", "Page.enable"]);
  assert.equal(firstClosed, true);
});

test("getPageByUrlPart reports the final attach phase after every same-snapshot candidate fails", async () => {
  const context = createContext();
  const firstTarget = { ...matchingTarget, webSocketDebuggerUrl: "ws://all-fail-first.test" };
  const secondTarget = { ...matchingTarget, webSocketDebuggerUrl: "ws://all-fail-second.test" };
  const closedTargets: string[] = [];
  let listReads = 0;
  await assert.rejects(
    getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
      listTargets: async () => {
        listReads += 1;
        return [firstTarget, secondTarget];
      },
      sleep: async () => { throw new Error("must_not_retry_target_list"); },
      now: () => 0,
      createCdp: (webSocketDebuggerUrl) => webSocketDebuggerUrl === firstTarget.webSocketDebuggerUrl
        ? {
          open: async () => { throw new CdpClientError("session_closed"); },
          send: async () => { throw new Error("must_not_send"); },
          close: () => { closedTargets.push("first"); }
        }
        : {
          open: async () => undefined,
          send: async (method: string) => {
            if (method === "Page.enable") throw new CdpClientError("session_closed");
          },
          close: () => { closedTargets.push("second"); }
        }
    }),
    (error) => {
      assertTargetDiscoveryError(error, "cdp_attach_failed", {
        listReadable: true,
        pageTargetCount: 2,
        petTargetCount: 2,
        chatTargetCount: 0,
        otherPageTargetCount: 0,
        invalidTargetCount: 0,
        matchingCandidateCount: 2,
        attemptedCandidateCount: 2,
        attachPhase: "page",
        attachFailureKind: "session_closed"
      });
      return true;
    }
  );
  assert.equal(listReads, 2);
  assert.deepEqual(closedTargets, ["first", "second", "first", "second"]);
  assert.equal(context.pages.length, 0);
});

test("getPageByUrlPart rereads the target list once when every candidate session is closed", async () => {
  const context = createContext();
  const closedTarget = { ...matchingTarget, webSocketDebuggerUrl: "ws://closed.test" };
  const recoveredTarget = { ...matchingTarget, webSocketDebuggerUrl: "ws://recovered.test" };
  let listReads = 0;
  let closedClient = false;
  const page = await getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
    listTargets: async () => {
      listReads += 1;
      return listReads === 1 ? [closedTarget] : [recoveredTarget];
    },
    sleep: async () => { throw new Error("must_not_sleep_before_session_retry"); },
    now: () => 0,
    createCdp: (webSocketDebuggerUrl) => webSocketDebuggerUrl === closedTarget.webSocketDebuggerUrl
      ? {
        open: async () => { throw new CdpClientError("session_closed"); },
        send: async () => { throw new Error("must_not_send"); },
        close: () => { closedClient = true; }
      }
      : {
        open: async () => undefined,
        send: async () => undefined,
        close: () => undefined
      }
  });
  assert.equal(page.target, recoveredTarget);
  assert.equal(listReads, 2);
  assert.equal(closedClient, true);
});

test("getPageByUrlPart does not reread the target list after a protocol attach error", async () => {
  const context = createContext();
  let listReads = 0;
  let closed = false;
  await assert.rejects(
    getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
      listTargets: async () => {
        listReads += 1;
        return [matchingTarget];
      },
      sleep: async () => { throw new Error("must_not_retry_target_list"); },
      now: () => 0,
      createCdp: () => ({
        open: async () => undefined,
        send: async () => { throw new CdpClientError("protocol_error"); },
        close: () => { closed = true; }
      })
    }),
    (error) => {
      assertTargetDiscoveryError(error, "cdp_attach_failed", {
        listReadable: true,
        pageTargetCount: 1,
        petTargetCount: 1,
        chatTargetCount: 0,
        otherPageTargetCount: 0,
        invalidTargetCount: 0,
        matchingCandidateCount: 1,
        attemptedCandidateCount: 1,
        attachPhase: "runtime",
        attachFailureKind: "protocol_error"
      });
      return true;
    }
  );
  assert.equal(listReads, 1);
  assert.equal(closed, true);
});

test("getPageByUrlPart does not reread session-closed candidates after the total deadline", async () => {
  const context = createContext();
  let now = 0;
  let listReads = 0;
  await assert.rejects(
    getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
      listTargets: async () => {
        listReads += 1;
        return [matchingTarget];
      },
      sleep: async () => { throw new Error("must_not_sleep_after_deadline"); },
      now: () => now,
      createCdp: () => ({
        open: async () => { now = 30_000; throw new CdpClientError("session_closed"); },
        send: async () => { throw new Error("must_not_send"); },
        close: () => undefined
      })
    }),
    (error) => {
      assertTargetDiscoveryError(error, "cdp_attach_failed", {
        listReadable: true,
        pageTargetCount: 1,
        petTargetCount: 1,
        chatTargetCount: 0,
        otherPageTargetCount: 0,
        invalidTargetCount: 0,
        matchingCandidateCount: 1,
        attemptedCandidateCount: 1,
        attachPhase: "open",
        attachFailureKind: "session_closed"
      });
      return true;
    }
  );
  assert.equal(listReads, 1);
});

test("getPageByUrlPart retains and attempts at most eight same-snapshot matching candidates", async () => {
  const context = createContext();
  const targets = Array.from({ length: 9 }, (_value, index) => ({
    ...matchingTarget,
    webSocketDebuggerUrl: `ws://cap-${index + 1}.test`
  }));
  const createdTargets: string[] = [];
  const closedTargets: string[] = [];
  let listReads = 0;
  let now = 0;
  await assert.rejects(
    getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
      listTargets: async () => {
        listReads += 1;
        return targets;
      },
      sleep: async () => { throw new Error("must_not_retry_target_list"); },
      now: () => now,
      createCdp: (webSocketDebuggerUrl) => {
        createdTargets.push(webSocketDebuggerUrl);
        return {
        open: async () => { throw new CdpClientError("session_closed"); },
          send: async () => { throw new Error("must_not_send"); },
          close: () => {
            closedTargets.push(webSocketDebuggerUrl);
            if (closedTargets.length === 8) now = 30_000;
          }
        };
      }
    }),
    (error) => {
      assertTargetDiscoveryError(error, "cdp_attach_failed", {
        listReadable: true,
        pageTargetCount: 8,
        petTargetCount: 8,
        chatTargetCount: 0,
        otherPageTargetCount: 0,
        invalidTargetCount: 0,
        matchingCandidateCount: 8,
        attemptedCandidateCount: 8,
        attachPhase: "open",
        attachFailureKind: "session_closed"
      });
      return true;
    }
  );
  assert.equal(listReads, 1);
  assert.deepEqual(createdTargets, targets.slice(0, 8).map((target) => target.webSocketDebuggerUrl));
  assert.deepEqual(closedTargets, createdTargets);
  assert.equal(context.pages.length, 0);
});

test("getPageByUrlPart passes only the remaining total deadline to each CDP attach phase", async () => {
  const context = createContext();
  let now = 0;
  const budgets: Array<[string, number]> = [];
  const page = await getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
    listTargets: async () => [matchingTarget],
    now: () => now,
    sleep: async () => { throw new Error("must_not_sleep"); },
    createCdp: () => ({
      commandTimeoutMs: 15_000,
      open: async (timeoutMs: number) => {
        budgets.push(["open", timeoutMs]);
        now = 10_000;
      },
      send: async (method: string, _params: unknown, timeoutMs: number) => {
        budgets.push([method, timeoutMs]);
        now += 10_000;
      },
      close: () => undefined
    })
  });

  assert.equal(page.target, matchingTarget);
  assert.deepEqual(budgets, [
    ["open", 30_000],
    ["Runtime.enable", 15_000],
    ["Page.enable", 10_000]
  ]);
  assert.equal(now <= 30_000, true);
});

test("getPageByUrlPart closes an attach whose open starts at the total-deadline edge", async () => {
  const context = createContext();
  let now = 0;
  let listReads = 0;
  let closed = false;
  await assert.rejects(
    getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
      listTargets: async () => {
        listReads += 1;
        now = 29_999;
        return [matchingTarget];
      },
      now: () => now,
      sleep: async () => { throw new Error("must_not_sleep_or_reread"); },
      createCdp: () => ({
        commandTimeoutMs: 15_000,
        open: async (timeoutMs: number) => {
          assert.equal(timeoutMs, 1);
          now = 30_000;
        },
        send: async () => { throw new Error("must_not_send_after_deadline"); },
        close: () => { closed = true; }
      })
    }),
    (error) => {
      assertTargetDiscoveryError(error, "cdp_attach_failed", {
        listReadable: true,
        pageTargetCount: 1,
        petTargetCount: 1,
        chatTargetCount: 0,
        otherPageTargetCount: 0,
        invalidTargetCount: 0,
        matchingCandidateCount: 1,
        attemptedCandidateCount: 1,
        attachPhase: "runtime",
        attachFailureKind: "command_timeout"
      });
      return true;
    }
  );
  assert.equal(listReads, 1);
  assert.equal(closed, true);
  assert.equal(now <= 30_000, true);
});

test("getPageByUrlPart closes before Page.enable when Runtime.enable consumes the remaining total deadline", async () => {
  const context = createContext();
  let now = 0;
  let listReads = 0;
  let closed = false;
  const calls: Array<[string, number]> = [];
  await assert.rejects(
    getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
      listTargets: async () => {
        listReads += 1;
        return [matchingTarget];
      },
      now: () => now,
      sleep: async () => { throw new Error("must_not_sleep_or_reread"); },
      createCdp: () => ({
        commandTimeoutMs: 15_000,
        open: async () => { now = 20_000; },
        send: async (method: string, _params: unknown, timeoutMs: number) => {
          calls.push([method, timeoutMs]);
          now = 30_000;
        },
        close: () => { closed = true; }
      })
    }),
    (error) => {
      assertTargetDiscoveryError(error, "cdp_attach_failed", {
        listReadable: true,
        pageTargetCount: 1,
        petTargetCount: 1,
        chatTargetCount: 0,
        otherPageTargetCount: 0,
        invalidTargetCount: 0,
        matchingCandidateCount: 1,
        attemptedCandidateCount: 1,
        attachPhase: "page",
        attachFailureKind: "command_timeout"
      });
      return true;
    }
  );
  assert.deepEqual(calls, [["Runtime.enable", 10_000]]);
  assert.equal(listReads, 1);
  assert.equal(closed, true);
  assert.equal(now <= 30_000, true);
});

test("getPageByUrlPart fails closed for a non-array target list", async () => {
  await assert.rejects(
    getPageByUrlPartWithDependencies(createContext(), "renderer/pet/index.html", 30_000, {
      listTargets: async () => ({ targets: [] }),
      sleep: async () => undefined,
      now: () => 0,
      createCdp: () => { throw new Error("must_not_attach"); }
    }),
    (error) => {
      assertTargetDiscoveryError(error, "target_list_shape_invalid", emptyTargetMetadata);
      return true;
    }
  );
});

test("getPageByUrlPart fails closed for malformed entries without leaking target data", async () => {
  await assert.rejects(
    getPageByUrlPartWithDependencies(createContext(), "renderer/pet/index.html", 30_000, {
      listTargets: async () => [{ type: "page", url: "file:///secret/malformed.html" }],
      sleep: async () => undefined,
      now: () => 0,
      createCdp: () => { throw new Error("must_not_attach"); }
    }),
    (error) => {
      assertTargetDiscoveryError(error, "target_entry_shape_invalid", {
        listReadable: true,
        pageTargetCount: 0,
        petTargetCount: 0,
        chatTargetCount: 0,
        otherPageTargetCount: 0,
        invalidTargetCount: 1,
        matchingCandidateCount: 0,
        attemptedCandidateCount: 0,
        attachPhase: null,
        attachFailureKind: null
      });
      return true;
    }
  );
});

test("getPageByUrlPart ignores malformed entries when a valid pet target exists", async () => {
  const context = createContext();
  const page = await getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 1_000, {
    listTargets: async () => [
      { type: "page", url: "file:///secret/malformed.html" },
      matchingTarget
    ],
    sleep: async () => undefined,
    createCdp: () => ({
      open: async () => undefined,
      send: async () => undefined
    })
  });

  assert.equal(page.target, matchingTarget);
  assert.equal(context.pages.length, 1);
});

test("getPageByUrlPart reports a safe not-found summary after readable nonmatching targets", async () => {
  const context = createContext();
  let now = 0;
  await assert.rejects(
    getPageByUrlPartWithDependencies(context, "renderer/pet/index.html", 30_000, {
      listTargets: async () => [{ type: "page", url: "file:///secret/other.html", webSocketDebuggerUrl: "ws://other" }],
      sleep: async () => { now = 30_000; },
      now: () => now,
      createCdp: () => { throw new Error("must_not_attach"); }
    }),
    (error) => {
      assertTargetDiscoveryError(error, "target_not_found", {
        listReadable: true,
        pageTargetCount: 1,
        petTargetCount: 0,
        chatTargetCount: 0,
        otherPageTargetCount: 1,
        invalidTargetCount: 0,
        matchingCandidateCount: 0,
        attemptedCandidateCount: 0,
        attachPhase: null,
        attachFailureKind: null
      });
      return true;
    }
  );
});

test("waitForJson aborts a hanging default list fetch within the caller deadline", async () => {
  let aborted = false;
  let attempts = 0;
  const startedAt = Date.now();
  const keepAlive = setTimeout(() => undefined, 250);
  try {
    await assert.rejects(
      waitForJsonWithDependencies("http://127.0.0.1:9876/json/list", 40, {
        fetchImpl: async (_url: string, { signal }: { signal: AbortSignal }) => {
          attempts += 1;
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              reject(signal.reason);
            }, { once: true });
          });
        },
        sleep: async () => undefined
      })
    );
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(aborted, true);
  assert.equal(attempts >= 1, true);
  assert.equal(Date.now() - startedAt < 200, true);
});

test("dynamic CDP uses the OS-assigned child port and trusts only its loopback announcement", async () => {
  const context = createRealUiRunContext({
    runName: "p2-91c-dynamic-port-test",
    port: 0,
    structuredFailures: true
  });
  const child = new EventEmitter() as EventEmitter & Record<string, any>;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  let args: string[] = [];

  try {
    startElectron(context, {
      spawnImpl: (_command: string, spawnArgs: string[]) => {
        args = spawnArgs;
        return child;
      }
    });
    child.stderr.emit("data", Buffer.from("DevTools listening on ws://0.0.0.0:61111/devtools/browser/not-owned\n"));
    assert.equal(context.port, 0);
    child.stderr.emit("data", Buffer.from("DevTools listening on ws://127.0.0.1:62222/devtools/browser/owned\n"));

    assert.ok(args.includes("--remote-debugging-port=0"));
    assert.equal(context.port, 62222);
    assert.equal(context.cdpEndpointOwned, true);
  } finally {
    cleanupRealUiRun(context);
  }
});

test("P2-91C1 harness owns a canonical acceptance runId and verifies whole-parent cleanup", () => {
  const context = createRealUiRunContext({
    runName: "p2-91c-acceptance-runid-test",
    env: { AI_DESKTOP_PET_ACCEPTANCE_RUN_ID: "caller-must-not-override" }
  });
  try {
    assert.match(context.acceptanceRunId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.equal(context.env.AI_DESKTOP_PET_ACCEPTANCE_RUN_ID, context.acceptanceRunId);
    assert.throws(() => assertRealUiRunParentRemoved(context));
    cleanupRealUiRun(context);
    assert.doesNotThrow(() => assertRealUiRunParentRemoved(context));
  } finally {
    if (existsSync(context.runParentDir)) cleanupRealUiRun(context);
  }
});

test("structured JSON discovery distinguishes child exit, HTTP error, and invalid JSON", async () => {
  const cases = [
    {
      category: "child_exit",
      dependencies: { child: { exitCode: 1, signalCode: null }, fetchImpl: async () => { throw new Error("must_not_fetch"); } }
    },
    {
      category: "http_error",
      dependencies: { fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) }
    },
    {
      category: "invalid_json",
      dependencies: { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("secret body"); } }) }
    }
  ];

  for (const fixture of cases) {
    await assert.rejects(
      waitForJsonWithDependencies("http://127.0.0.1:1/json/list", 100, {
        structuredFailures: true,
        sleep: async () => undefined,
        ...fixture.dependencies
      }),
      (error) => error instanceof RealUiHarnessError && error.category === fixture.category
    );
  }
});

test("structured JSON discovery interrupts a hanging request when its child exits", async () => {
  const child = new EventEmitter() as EventEmitter & Record<string, any>;
  child.exitCode = null;
  child.signalCode = null;
  const startedAt = Date.now();
  const pending = assert.rejects(
    waitForJsonWithDependencies("http://127.0.0.1:1/json/list", 1_000, {
      child,
      structuredFailures: true,
      fetchImpl: async () => new Promise(() => undefined),
      sleep: async () => undefined
    }),
    (error) => error instanceof RealUiHarnessError && error.category === "child_exit"
  );
  setTimeout(() => {
    child.exitCode = 1;
    child.emit("exit", 1);
  }, 10);
  await pending;
  assert.equal(Date.now() - startedAt < 200, true);
});

test("structured target discovery retries transient transport and ends in target_timeout", async () => {
  let now = 0;
  let reads = 0;
  await assert.rejects(
    getPageByUrlPartWithDependencies(
      { port: 9876, pages: [], structuredFailures: true, child: { exitCode: null, signalCode: null } },
      "renderer/pet/index.html",
      1_000,
      {
        listTargets: async () => {
          reads += 1;
          throw new TypeError("transient transport detail");
        },
        sleep: async () => { now += 500; },
        now: () => now
      }
    ),
    (error) => error instanceof RealUiHarnessError && error.category === "target_timeout"
  );
  assert.equal(reads, 2);
});

test("structured acceptance emits exactly one JSON result for product assertions", async () => {
  const outputs: string[] = [];
  const result = await runStructuredRealUiAcceptance({
    initialResult: { lineCount: 0 },
    execute: async () => { assert.fail("private product detail"); },
    cleanupSteps: [async () => undefined],
    emit: (line: string) => outputs.push(line)
  });

  assert.equal(outputs.length, 1);
  assert.deepEqual(JSON.parse(outputs[0]), result);
  assert.deepEqual(result, {
    ok: false,
    lineCount: 0,
    failure: { category: "product_assertion" },
    cleaned: true
  });
  assert.equal(outputs[0].includes("private product detail"), false);
});

test("structured acceptance preserves each discovery failure category in its single JSON result", async () => {
  for (const category of ["child_exit", "http_error", "invalid_json", "target_timeout"]) {
    const outputs: string[] = [];
    const result = await runStructuredRealUiAcceptance({
      initialResult: { lineCount: 0 },
      execute: async () => { throw new RealUiHarnessError(category); },
      cleanupSteps: [async () => undefined],
      emit: (line: string) => outputs.push(line)
    });
    assert.equal(outputs.length, 1);
    assert.deepEqual(JSON.parse(outputs[0]), result);
    assert.deepEqual(result.failure, { category });
    assert.equal(result.ok, false);
  }
});

test("structured acceptance emits exactly one successful JSON result after cleanup", async () => {
  const outputs: string[] = [];
  const result = await runStructuredRealUiAcceptance({
    initialResult: { lineCount: 0 },
    execute: async () => ({ lineCount: 4 }),
    cleanupSteps: [async () => undefined],
    emit: (line: string) => outputs.push(line)
  });
  assert.equal(outputs.length, 1);
  assert.deepEqual(JSON.parse(outputs[0]), result);
  assert.deepEqual(result, { ok: true, lineCount: 4, cleaned: true });
});

test("structured acceptance runs every cleanup step and fails closed on cleanup error", async () => {
  const cleanupCalls: number[] = [];
  const outputs: string[] = [];
  const result = await runStructuredRealUiAcceptance({
    initialResult: { lineCount: 0 },
    execute: async () => ({ lineCount: 3 }),
    cleanupSteps: [
      async () => { cleanupCalls.push(1); throw new Error("private cleanup detail"); },
      async () => { cleanupCalls.push(2); }
    ],
    emit: (line: string) => outputs.push(line)
  });

  assert.deepEqual(cleanupCalls, [1, 2]);
  assert.equal(outputs.length, 1);
  assert.deepEqual(result, {
    ok: false,
    lineCount: 3,
    failure: { category: "cleanup_failure" },
    cleaned: false
  });
});

test("P2-91C1 real UI runner matches fake-provider chat and ordered product telemetry", () => {
  const runner = readFileSync(join(process.cwd(), "scripts", "p2-91c-telemetry-real-ui.mjs"), "utf8");
  assert.doesNotMatch(runner, /provider_request_completed/u);
  assert.match(runner, /chat_stream_completed/u);
  assert.match(runner, /message-pet/u);
  assert.match(runner, /chatUiSelectors\.chat\.input[\s\S]*disabled/u);
  assert.match(runner, /createRunDeadline\(70_000\)/u);
  assert.match(runner, /waitForActionLifecycleIdle/u);
  assert.match(runner, /runBodyActionAcceptance/u);
  assert.match(runner, /rect\.width > 0 && rect\.height > 0/u);
  assert.match(runner, /rect\.width \* 0\.5/u);
  assert.match(runner, /rect\.height \* 0\.48/u);
  const actionStarted = runner.indexOf("runBodyActionAcceptance");
  const recoveryStarted = runner.indexOf('event.type === "recovery_started"');
  const recoverySucceeded = runner.indexOf('event.type === "recovery_succeeded"');
  assert.ok(actionStarted >= 0 && actionStarted < recoveryStarted);
  assert.ok(recoveryStarted < recoverySucceeded);
  assert.match(runner, /observedLineCount/u);
  assert.match(runner, /bodyAttempt/u);
});

test("P2-91C1 action lifecycle waits for a stable zero-active window", async () => {
  let now = 0;
  const events = [
    { type: "pet_interaction_action_started", payload: { actionType: "appearance" } },
    { type: "pet_interaction_action_skipped", payload: { actionType: "quietNod" } }
  ];
  const progress: Record<string, unknown>[] = [];
  const deadline = createRunDeadline(5_000, { now: () => now });
  const result = await waitForActionLifecycleIdle({
    readEvents: () => events,
    deadline,
    stableMs: 550,
    pollMs: 50,
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
      if (now === 200) {
        events.push({ type: "pet_interaction_action_finished", payload: { actionType: "appearance", terminalStatus: "completed" } });
      }
    },
    onProgress: (summary: Record<string, unknown>) => progress.push(summary)
  });
  assert.equal(now, 750);
  assert.equal(result.active, 0);
  assert.ok(progress.every((item) => !("reason" in item) && !("requestId" in item)));
});

test("P2-91C1 action lifecycle requires started then finished and fails immediately on skipped", async () => {
  let now = 0;
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const deadline = createRunDeadline(5_000, { now: () => now });
  const outcomePromise = waitForActionLifecycleResult({
    readEvents: () => events,
    afterIndex: 0,
    actionType: "bodyAttentionTurn",
    deadline,
    pollMs: 50,
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
      if (now === 50) events.push({ type: "pet_interaction_action_started", payload: { actionType: "bodyAttentionTurn" } });
      if (now === 100) events.push({ type: "pet_interaction_action_finished", payload: { actionType: "bodyAttentionTurn", terminalStatus: "completed" } });
    }
  });
  const outcome = await outcomePromise;
  assert.equal(outcome.bodyStarted, 1);
  assert.equal(outcome.bodyFinished, 1);
  assert.equal(outcome.terminal.completed, 1);

  const skipped = [{ type: "pet_interaction_action_skipped", payload: { actionType: "bodyAttentionTurn" } }];
  await assert.rejects(waitForActionLifecycleResult({
    readEvents: () => skipped,
    afterIndex: 0,
    actionType: "bodyAttentionTurn",
    deadline: createRunDeadline(5_000),
    sleep: async () => undefined
  }), (error: unknown) => error instanceof RealUiHarnessError && error.category === "product_assertion");
});

test("P2-91C1 action aggregation is safe and missing terminal fails closed", async () => {
  const events = [
    { type: "pet_interaction_action_started", payload: { actionType: "bodyAttentionTurn", requestId: "private" } },
    { type: "pet_interaction_action_finished", payload: { actionType: "bodyAttentionTurn" } },
    { type: "pet_interaction_action_started", payload: { actionType: "quietNod" } }
  ];
  const summary = summarizeActionLifecycle(events, 0, "bodyAttentionTurn");
  assert.deepEqual(Object.keys(summary).sort(), [
    "active", "bodyFinished", "bodySkipped", "bodyStarted", "missingTerminal",
    "otherFinished", "otherSkipped", "otherStarted", "terminal", "unmatchedFinished"
  ]);
  assert.equal(summary.missingTerminal, 1);
  assert.equal(JSON.stringify(summary).includes("private"), false);
  await assert.rejects(waitForActionLifecycleResult({
    readEvents: () => events,
    afterIndex: 0,
    actionType: "bodyAttentionTurn",
    deadline: createRunDeadline(5_000),
    sleep: async () => undefined
  }), (error: unknown) => error instanceof RealUiHarnessError && error.category === "product_assertion");
});

test("P2-91C1 strict lifecycle state rejects orphan, duplicate, and mismatched finished", async () => {
  for (const events of [
    [{ type: "pet_interaction_action_finished", payload: { actionType: "quietNod", terminalStatus: "completed" } }],
    [
      { type: "pet_interaction_action_started", payload: { actionType: "quietNod" } },
      { type: "pet_interaction_action_finished", payload: { actionType: "quietNod", terminalStatus: "completed" } },
      { type: "pet_interaction_action_finished", payload: { actionType: "quietNod", terminalStatus: "completed" } }
    ],
    [
      { type: "pet_interaction_action_started", payload: { actionType: "bodyAttentionTurn" } },
      { type: "pet_interaction_action_finished", payload: { actionType: "quietNod", terminalStatus: "completed" } }
    ]
  ]) {
    const summary = summarizeActionLifecycle(events, 0, "bodyAttentionTurn");
    assert.equal(summary.unmatchedFinished, 1);
    await assert.rejects(waitForActionLifecycleIdle({
      readEvents: () => events,
      deadline: createRunDeadline(5_000),
      sleep: async () => undefined
    }), (error: unknown) => error instanceof RealUiHarnessError && error.category === "product_assertion");
  }
});

test("P2-91C1 absolute run deadline caps every stage and reports run_timeout", () => {
  let now = 100;
  const deadline = createRunDeadline(1_000, { now: () => now });
  assert.equal(deadline.remaining(5_000), 1_000);
  now = 900;
  assert.equal(deadline.remaining(500), 200);
  now = 1_100;
  assert.throws(() => deadline.remaining(500), (error: unknown) => (
    error instanceof RealUiHarnessError && error.category === "run_timeout"
  ));
});

test("P2-91C1 lifecycle timeout exposes only inferred missing-terminal count", async () => {
  let now = 0;
  let finalSummary: Record<string, any> | null = null;
  await assert.rejects(waitForActionLifecycleIdle({
    readEvents: () => [{ type: "pet_interaction_action_started", payload: { actionType: "quietNod", reason: "private" } }],
    deadline: createRunDeadline(100, { now: () => now }),
    stageTimeoutMs: 100,
    pollMs: 50,
    now: () => now,
    sleep: async (ms: number) => { now += ms; },
    onProgress: (summary: Record<string, unknown>) => { finalSummary = summary; }
  }), (error: unknown) => error instanceof RealUiHarnessError && error.category === "run_timeout");
  assert.equal(finalSummary?.missingTerminal, 1);
  assert.equal(JSON.stringify(finalSummary).includes("private"), false);
});

test("P2-91C1 bounded body acceptance passes first-attempt completed without retrigger", async () => {
  const state = fakeBodyRun((attempt, events) => {
    if (attempt === 1 && events.length === 0) {
      events.push(lifecycleEvent("pet_interaction_action_started", "bodyAttentionTurn"));
      events.push(lifecycleEvent("pet_interaction_action_finished", "bodyAttentionTurn", "completed"));
    }
  });
  assert.deepEqual(await state.run, {
    attempt: 1, bodyState: "completed", bodySkipReason: null,
    competingActionType: null, terminal: "completed", idle: false
  });
  assert.equal(state.attempts, 1);
});

test("P2-91C1 active contention waits terminal and full 550ms idle before one retry", async () => {
  let competingFinished = false;
  const state = fakeBodyRun((attempt, events, now) => {
    if (attempt === 1 && events.length === 0) {
      events.push(lifecycleEvent("pet_interaction_action_started", "quietNod"));
      events.push(lifecycleEvent("pet_interaction_action_skipped", "bodyAttentionTurn", undefined, "active_action"));
    }
    if (attempt === 1 && now >= 10 && !competingFinished) {
      competingFinished = true;
      events.push(lifecycleEvent("pet_interaction_action_finished", "quietNod", "interrupted"));
    }
    if (attempt === 2 && !events.some((event) => event.payload.actionType === "bodyAttentionTurn" && event.type === "pet_interaction_action_started")) {
      events.push(lifecycleEvent("pet_interaction_action_started", "bodyAttentionTurn"));
      events.push(lifecycleEvent("pet_interaction_action_finished", "bodyAttentionTurn", "completed"));
    }
  });
  const result = await state.run;
  assert.equal(state.attempts, 2);
  assert.ok(state.now >= 560);
  assert.equal(state.progress.some((item) => item.attempt === 1 && item.idle === true), true);
  assert.deepEqual(result, {
    attempt: 2, bodyState: "completed", bodySkipReason: null,
    competingActionType: null, terminal: "completed", idle: false
  });
});

test("P2-91C1 active contention rejects absent, unknown, and pre-index-only competitors", async () => {
  for (const setup of [
    (events: any[]) => events.push(lifecycleEvent("pet_interaction_action_skipped", "bodyAttentionTurn", undefined, "active_action")),
    (events: any[]) => {
      events.push(lifecycleEvent("pet_interaction_action_started", "notProduction"));
      events.push(lifecycleEvent("pet_interaction_action_skipped", "bodyAttentionTurn", undefined, "active_action"));
    }
  ]) {
    const state = fakeBodyRun((attempt, events) => { if (attempt === 1 && events.length === 0) setup(events); });
    await assert.rejects(state.run, (error: unknown) => error instanceof RealUiHarnessError && error.category === "product_assertion");
    assert.equal(state.attempts, 1);
  }

  let now = 0;
  let attempts = 0;
  const events = [lifecycleEvent("pet_interaction_action_started", "quietNod")];
  await assert.rejects(runBodyActionAcceptance({
    readEvents: () => events,
    trigger: async () => {
      attempts += 1;
      events.push(lifecycleEvent("pet_interaction_action_skipped", "bodyAttentionTurn", undefined, "active_action"));
      return true;
    },
    actionType: "bodyAttentionTurn", actionTypes: BODY_ACTION_TYPES,
    deadline: createRunDeadline(70_000, { now: () => now }), now: () => now,
    sleep: async (ms: number) => { now += ms; }
  }), (error: unknown) => error instanceof RealUiHarnessError && error.category === "product_assertion");
  assert.equal(attempts, 1);
});

test("P2-91C1 global cooldown requires a same-attempt concrete finished competitor", async () => {
  const accepted = fakeBodyRun((attempt, events) => {
    if (attempt === 1 && events.length === 0) {
      events.push(lifecycleEvent("pet_interaction_action_started", "appearance"));
      events.push(lifecycleEvent("pet_interaction_action_finished", "appearance", "failed"));
      events.push(lifecycleEvent("pet_interaction_action_skipped", "bodyAttentionTurn", undefined, "global_cooldown"));
    }
    if (attempt === 2 && !events.some((event) => (
      event.type === "pet_interaction_action_started" && event.payload.actionType === "bodyAttentionTurn"
    ))) {
      events.push(lifecycleEvent("pet_interaction_action_started", "bodyAttentionTurn"));
      events.push(lifecycleEvent("pet_interaction_action_finished", "bodyAttentionTurn", "completed"));
    }
  });
  assert.equal((await accepted.run).attempt, 2);

  const rejected = fakeBodyRun((attempt, events) => {
    if (attempt === 1 && events.length === 0) {
      events.push(lifecycleEvent("pet_interaction_action_skipped", "bodyAttentionTurn", undefined, "global_cooldown"));
    }
  });
  await assert.rejects(rejected.run, (error: unknown) => error instanceof RealUiHarnessError && error.category === "product_assertion");
});

test("P2-91C1 non-contention skip reasons fail immediately", async () => {
  for (const reason of ["head_pat_cooldown", "same_action_cooldown", "window_shake_feedback_cooldown", undefined, "unknown"]) {
    const state = fakeBodyRun((attempt, events) => {
      if (attempt === 1 && events.length === 0) {
        events.push(lifecycleEvent("pet_interaction_action_skipped", "bodyAttentionTurn", undefined, reason));
      }
    });
    await assert.rejects(state.run, (error: unknown) => error instanceof RealUiHarnessError && error.category === "product_assertion");
    assert.equal(state.attempts, 1);
  }
});

test("P2-91C1 body non-completed terminals fail locked attempt without retry", async () => {
  for (const terminal of ["interrupted", "timed_out", "failed"]) {
    const state = fakeBodyRun((attempt, events) => {
      if (attempt === 1 && events.length === 0) {
        events.push(lifecycleEvent("pet_interaction_action_started", "bodyAttentionTurn"));
        events.push(lifecycleEvent("pet_interaction_action_finished", "bodyAttentionTurn", terminal));
      }
    });
    await assert.rejects(state.run, (error: unknown) => error instanceof RealUiHarnessError && error.category === "product_assertion");
    assert.equal(state.attempts, 1);
  }
});

test("P2-91C1 three evidenced contention attempts end persistent_contention", async () => {
  const state = fakeBodyRun((attempt, events) => {
    const marker = `quiet-${attempt}`;
    if (!events.some((event) => event.marker === marker)) {
      const started = lifecycleEvent("pet_interaction_action_started", "quietNod");
      started.marker = marker;
      events.push(started);
      events.push(lifecycleEvent("pet_interaction_action_finished", "quietNod", "completed"));
      events.push(lifecycleEvent("pet_interaction_action_skipped", "bodyAttentionTurn", undefined, "active_action"));
    }
  });
  await assert.rejects(state.run, (error: unknown) => error instanceof RealUiHarnessError && error.category === "persistent_contention");
  assert.equal(state.attempts, 3);
});

test("P2-91C1 shared deadline expires in contention terminal or idle wait", async () => {
  const terminalWait = fakeBodyRun((attempt, events) => {
    if (attempt === 1 && events.length === 0) {
      events.push(lifecycleEvent("pet_interaction_action_started", "quietNod"));
      events.push(lifecycleEvent("pet_interaction_action_skipped", "bodyAttentionTurn", undefined, "active_action"));
    }
  }, 50);
  await assert.rejects(terminalWait.run, (error: unknown) => error instanceof RealUiHarnessError && error.category === "run_timeout");
  assert.equal(terminalWait.attempts, 1);

  const idleWait = fakeBodyRun((attempt, events) => {
    if (attempt === 1 && events.length === 0) {
      events.push(lifecycleEvent("pet_interaction_action_started", "quietNod"));
      events.push(lifecycleEvent("pet_interaction_action_finished", "quietNod", "completed"));
      events.push(lifecycleEvent("pet_interaction_action_skipped", "bodyAttentionTurn", undefined, "active_action"));
    }
  }, 549);
  await assert.rejects(idleWait.run, (error: unknown) => error instanceof RealUiHarnessError && error.category === "run_timeout");
  assert.equal(idleWait.attempts, 1);
});

test("P2-91C1 body structured result is exact and fails closed", () => {
  const valid = {
    attempt: 1, bodyState: "skipped", bodySkipReason: "active_action",
    competingActionType: "quietNod", terminal: "failed", idle: true
  };
  assert.deepEqual(createSafeBodyAttemptResult(valid, BODY_ACTION_TYPES), valid);
  for (const invalid of [
    { ...valid, raw: "private" },
    { ...valid, requestId: "private" },
    { ...valid, bodyState: "free text" },
    { ...valid, competingActionType: "notProduction" },
    { ...valid, idle: "true" }
  ]) assert.equal(createSafeBodyAttemptResult(invalid, BODY_ACTION_TYPES), null);
});
