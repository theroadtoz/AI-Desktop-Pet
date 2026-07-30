import assert from "node:assert/strict";
import test from "node:test";

import { CdpClientError, TargetDiscoveryError, getPageByUrlPartWithDependencies, waitForJsonWithDependencies } from "./real-ui-harness.mjs";

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
