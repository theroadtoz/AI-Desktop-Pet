import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { parseVtsRecorderArgs, runVtsMotionRecorderCli } from "./vts-motion-recorder.mjs";

test("CLI parses inspect and record with loopback-only port configuration", () => {
  assert.deepEqual(parseVtsRecorderArgs(["inspect"]), { command: "inspect", port: 8001 });
  assert.deepEqual(parseVtsRecorderArgs([
    "record",
    "--name", "yawn-draft",
    "--duration", "4.5",
    "--confirm-record",
    "--fps", "30",
    "--draft-root", "E:\\Work-26\\AI_Desktop_Pet\\.tmp\\vts",
    "--port", "9001"
  ]), {
    command: "record",
    port: 9001,
    name: "yawn-draft",
    durationSeconds: 4.5,
    fps: 30,
    draftRoot: "E:\\Work-26\\AI_Desktop_Pet\\.tmp\\vts",
    confirmRecord: true
  });
  assert.throws(() => parseVtsRecorderArgs(["inspect", "--port", "0"]), /invalid-port/);
  assert.throws(() => parseVtsRecorderArgs(["inspect", "--host", "example.com"]), /usage/);
  assert.throws(() => parseVtsRecorderArgs(["inspect", "--port"]), /usage/);
  assert.throws(() => parseVtsRecorderArgs(["inspect", "--auth-root", "secret-cache"]), /usage/);
  assert.throws(() => parseVtsRecorderArgs(["inspect", "--confirm-record"]), /usage/);
  assert.throws(() => parseVtsRecorderArgs([
    "record", "--name", "yawn", "--duration", "1", "--unknown"
  ]), /usage/);
  assert.throws(() => parseVtsRecorderArgs([
    "record", "--name", "yawn", "--duration", "1", "--fps", "31"
  ]), /invalid-fps/);
});

test("CLI defaults record drafts to cwd/.tmp/vts-drafts", () => {
  assert.deepEqual(parseVtsRecorderArgs(["record", "--name", "yawn", "--duration", "1"]), {
    command: "record",
    port: 8001,
    name: "yawn",
    durationSeconds: 1,
    fps: 30,
    draftRoot: resolve(process.cwd(), ".tmp", "vts-drafts"),
    confirmRecord: false
  });
  assert.equal(
    parseVtsRecorderArgs(["record", "--name", "yawn", "--duration", "1"], { draftRoot: "C:\\UserData\\motion-drafts\\vts-drafts" }).draftRoot,
    "C:\\UserData\\motion-drafts\\vts-drafts"
  );
});

test("record --confirm-record confirms without creating readline", async () => {
  let confirmed = false;
  let writeArguments: unknown[] = [];
  const core = {
    recordVtsMotion: async (_adapter: unknown, options: { runtime: { confirmStart(): Promise<boolean> } }) => {
      confirmed = await options.runtime.confirmStart();
      return { motion: {}, summary: { safeSummaryOnly: true, status: "recorded" } };
    },
    writeMotionDraft: async (...args: unknown[]) => {
      writeArguments = args;
      return "yawn.motion3.json";
    }
  };

  const code = await runVtsMotionRecorderCli([
    "record", "--name", "yawn", "--duration", "1", "--confirm-record"
  ], {
    adapter: { close: async () => {} },
    core,
    createInterface: () => { throw new Error("readline-created"); },
    output: () => {}
  });

  assert.equal(code, 0);
  assert.equal(confirmed, true);
  assert.equal(writeArguments[0], resolve(process.cwd(), ".tmp", "vts-drafts"));
  assert.equal(writeArguments[3], resolve(process.cwd(), ".tmp"));
});

test("record without --confirm-record keeps interactive readline confirmation", async () => {
  let prompt = "";
  let closed = false;
  const core = {
    recordVtsMotion: async (_adapter: unknown, options: { runtime: { confirmStart(): Promise<boolean> } }) => {
      assert.equal(await options.runtime.confirmStart(), true);
      return { motion: {}, summary: { safeSummaryOnly: true, status: "recorded" } };
    },
    writeMotionDraft: async () => "yawn.motion3.json"
  };

  const code = await runVtsMotionRecorderCli([
    "record", "--name", "yawn", "--duration", "1"
  ], {
    adapter: { close: async () => {} },
    core,
    createInterface: () => ({
      question: async (receivedPrompt: string) => {
        prompt = receivedPrompt;
        return "record";
      },
      close: () => { closed = true; }
    }),
    output: () => {}
  });

  assert.equal(code, 0);
  assert.equal(prompt, "输入 record 明确开始录制，其他输入取消: ");
  assert.equal(closed, true);
});

test("CLI converts invalid arguments into a safe summary without a stack trace", async () => {
  const lines: string[] = [];
  const code = await runVtsMotionRecorderCli(["inspect", "--host", "example.com"], {
    output: (line: string) => lines.push(line)
  });
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    safeSummaryOnly: true,
    status: "blocked",
    blocker: "recorder-failed"
  });
  assert.equal(lines.join("\n").includes("at runVtsMotionRecorderCli"), false);
});

test("CLI maps fixed timeout codes and redacts arbitrary error text", async () => {
  const timeoutCodes = [
    "api-state-timeout",
    "authentication-token-timeout",
    "authentication-timeout",
    "current-model-timeout",
    "parameter-list-timeout"
  ];

  for (const timeoutCode of timeoutCodes) {
    const lines: string[] = [];
    const code = await runVtsMotionRecorderCli(["inspect"], {
      adapter: { close: async () => {} },
      core: { inspectVts: async () => { throw { code: timeoutCode }; } },
      output: (line: string) => lines.push(line)
    });

    assert.equal(code, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      safeSummaryOnly: true,
      status: "blocked",
      blocker: timeoutCode
    });
  }

  const lines: string[] = [];
  const secret = "sensitive arbitrary error text";
  const code = await runVtsMotionRecorderCli(["inspect"], {
    adapter: { close: async () => {} },
    core: { inspectVts: async () => { throw { code: secret, message: secret }; } },
    output: (line: string) => lines.push(line)
  });

  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    safeSummaryOnly: true,
    status: "blocked",
    blocker: "recorder-failed"
  });
  assert.equal(lines.join("\n").includes(secret), false);
});

test("CLI injects the ws constructor into the Node WebSocket adapter", async () => {
  const adapter = { close: async () => {} };
  let receivedConstructor: unknown;
  const core = {
    createNodeWebSocketAdapter: async (_port: number, WebSocketConstructor: unknown) => {
      receivedConstructor = WebSocketConstructor;
      return adapter;
    },
    inspectVts: async () => ({ apiActive: true })
  };

  const code = await runVtsMotionRecorderCli(["inspect"], { core, output: () => {} });

  assert.equal(code, 0);
  assert.equal(receivedConstructor, WebSocket);
});

test("inspect logs only the safe summary and closes the injected adapter", async () => {
  const lines: string[] = [];
  let closed = false;
  const adapter = { close: async () => { closed = true; } };
  const secret = "test-auth-token";
  const tokenStore = { load: async () => secret, save: async () => {}, remove: async () => {} };
  const core = {
    inspectVts: async (received: unknown, options: { tokenStore: unknown }) => {
      assert.equal(received, adapter);
      assert.equal(options.tokenStore, tokenStore);
      return {
        apiActive: true,
        authenticated: true,
        modelLoaded: true,
        parameterCount: 237,
        semanticParameterCount: 9
      };
    }
  };

  const code = await runVtsMotionRecorderCli(["inspect"], {
    adapter,
    core,
    tokenStore,
    output: (line: string) => lines.push(line)
  });

  assert.equal(code, 0);
  assert.equal(closed, true);
  assert.equal(lines.join("\n").includes(secret), false);
  assert.equal(lines.join("\n").includes("model3.json"), false);
  assert.equal(lines.join("\n").includes("parameterValues"), false);
});

test("record requires explicit confirmation and logs no token, values, or model path", async () => {
  const lines: string[] = [];
  const secret = "test-auth-token";
  let confirmed = false;
  const adapter = { close: async () => {} };
  const tokenStore = { load: async () => secret, save: async () => {}, remove: async () => {} };
  let receivedDraftRoot = "";
  let receivedAllowedRoot = "";
  const core = {
    recordVtsMotion: async (_adapter: unknown, options: {
      runtime: { confirmStart(): Promise<boolean> };
      tokenStore: unknown;
    }) => {
      assert.equal(options.tokenStore, tokenStore);
      confirmed = await options.runtime.confirmStart();
      return {
        motion: { privateParameterValue: 0.123 },
        summary: {
          safeSummaryOnly: true,
          status: "recorded",
          fps: 30,
          sampleCount: 31,
          curveCount: 9,
          durationSeconds: 1.6,
          consistencyCheck: true
        }
      };
    },
    writeMotionDraft: async (draftRoot: string, _name: string, _motion: unknown, allowedDraftRoot: string) => {
      receivedDraftRoot = draftRoot;
      receivedAllowedRoot = allowedDraftRoot;
      return "E:\\Work-26\\AI_Desktop_Pet\\.tmp\\vts\\yawn.motion3.json";
    }
  };
  const runtime = {
    now: () => 0,
    sleep: async () => {},
    confirmStart: async () => true
  };

  const code = await runVtsMotionRecorderCli([
    "record", "--name", "yawn", "--duration", "1", "--draft-root", "E:\\Work-26\\AI_Desktop_Pet\\.tmp\\vts"
  ], { adapter, core, runtime, tokenStore, output: (line: string) => lines.push(line) });

  const log = lines.join("\n");
  assert.equal(code, 0);
  assert.equal(confirmed, true);
  assert.equal(log.includes("0.123"), false);
  assert.equal(log.includes("authenticationToken"), false);
  assert.equal(log.includes("AI_Desktop_Pet"), false);
  assert.equal(log.includes("yawn.motion3.json"), true);
  assert.equal(receivedDraftRoot, "E:\\Work-26\\AI_Desktop_Pet\\.tmp\\vts");
  assert.equal(receivedAllowedRoot, resolve(process.cwd(), ".tmp"));
});

test("CLI constrains explicit draft roots to the injected allowed root", async () => {
  const allowedDraftRoot = "C:\\UserData\\motion-drafts";
  const explicitDraftRoot = "C:\\outside\\vts-drafts";
  const lines: string[] = [];
  let receivedAllowedRoot = "";
  const code = await runVtsMotionRecorderCli([
    "record", "--name", "yawn", "--duration", "1", "--confirm-record", "--draft-root", explicitDraftRoot
  ], {
    adapter: { close: async () => {} },
    allowedDraftRoot,
    core: {
      recordVtsMotion: async () => ({ motion: {}, summary: { safeSummaryOnly: true, status: "recorded" } }),
      writeMotionDraft: async (_draftRoot: string, _name: string, _motion: unknown, received: string) => {
        receivedAllowedRoot = received;
        throw { code: "invalid-draft-root" };
      }
    },
    output: (line: string) => lines.push(line)
  });

  assert.equal(code, 1);
  assert.equal(receivedAllowedRoot, allowedDraftRoot);
  assert.equal(lines[0].includes(explicitDraftRoot), false);
  assert.equal(JSON.parse(lines[0]).blocker, "invalid-draft-root");
});

test("record forwards runtime cues to the overlay and always destroys it", async () => {
  const events: string[] = [];
  const overlay = {
    showCountdown: async (cue: number | string) => { events.push(String(cue)); },
    showRecording: async () => { events.push("录制中"); },
    destroy: () => { events.push("destroy"); }
  };
  const core = {
    recordVtsMotion: async (_adapter: unknown, options: { runtime: any }) => {
      for (const cue of [3, 2, 1, "开始"]) await options.runtime.onCountdown(cue);
      await options.runtime.onRecordingStart();
      throw { code: "authentication-denied", token: "must-not-leak" };
    }
  };
  const lines: string[] = [];
  const code = await runVtsMotionRecorderCli([
    "record", "--name", "yawn", "--duration", "1"
  ], {
    adapter: { close: async () => {} },
    core,
    overlay,
    runtime: { now: () => 0, sleep: async () => {}, confirmStart: async () => true },
    output: (line: string) => lines.push(line)
  });

  assert.equal(code, 1);
  assert.deepEqual(events, ["3", "2", "1", "开始", "录制中", "destroy"]);
  assert.equal(lines.join("\n").includes("must-not-leak"), false);
});
