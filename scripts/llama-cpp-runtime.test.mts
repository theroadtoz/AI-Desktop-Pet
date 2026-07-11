import assert from "node:assert/strict";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  buildLlamaCppSpawnArgs,
  createLlamaCppRuntime,
  readLlamaCppRuntimeConfigFromEnv
} = require("../dist/main/services/local-runtime/llama-cpp-runtime.js") as typeof import("../src/main/services/local-runtime/llama-cpp-runtime");

type SpawnCall = {
  command: string;
  args: string[];
  options: SpawnOptions;
  child: FakeChild;
};

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  pid = 4321;

  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => {
      this.emit("close", 0, null);
    });
    return true;
  }
}

test("env parser keeps managed llama.cpp disabled by default", () => {
  const config = readLlamaCppRuntimeConfigFromEnv({});

  assert.equal(config.enabled, false);
  assert.equal(config.executablePath, undefined);
  assert.equal(config.modelPath, undefined);
});

test("disabled runtime does not spawn even when paths are configured", async () => {
  const files = createTempRuntimeFiles();
  const fake = createFakeSpawn();

  try {
    const runtime = createLlamaCppRuntime({
      enabled: false,
      executablePath: files.executablePath,
      modelPath: files.modelPath
    }, { spawn: fake.spawn });
    const summary = await runtime.start();

    assert.equal(summary.status, "disabled");
    assert.equal(fake.calls.length, 0);
    assert.equal(summary.safeSummaryOnly, true);
  } finally {
    files.cleanup();
  }
});

test("enabled runtime reports missing binary before spawn", async () => {
  const files = createTempRuntimeFiles();
  const fake = createFakeSpawn();

  try {
    const runtime = createLlamaCppRuntime({
      enabled: true,
      executablePath: join(files.root, "missing-llama-server.exe"),
      modelPath: files.modelPath
    }, { spawn: fake.spawn });
    const summary = await runtime.start();

    assert.equal(summary.status, "missing_binary");
    assert.equal(fake.calls.length, 0);
  } finally {
    files.cleanup();
  }
});

test("enabled runtime reports missing model and invalid gguf extension safely", async () => {
  const files = createTempRuntimeFiles();
  const fake = createFakeSpawn();

  try {
    const missingModel = createLlamaCppRuntime({
      enabled: true,
      executablePath: files.executablePath,
      modelPath: join(files.root, "missing-model.gguf")
    }, { spawn: fake.spawn });
    const missingSummary = await missingModel.start();

    writeFileSync(files.invalidModelPath, "fake model", "utf8");
    const invalidModel = createLlamaCppRuntime({
      enabled: true,
      executablePath: files.executablePath,
      modelPath: files.invalidModelPath
    }, { spawn: fake.spawn });
    const invalidSummary = await invalidModel.start();

    assert.equal(missingSummary.status, "missing_model");
    assert.equal(invalidSummary.status, "missing_model");
    assert.equal(invalidSummary.reason, "invalid_model_extension");
    assert.equal(fake.calls.length, 0);
  } finally {
    files.cleanup();
  }
});

test("spawn args include llama-server flags while summary omits complete local paths", async () => {
  const files = createTempRuntimeFiles();
  const server = createHealthServer();
  const fake = createFakeSpawn();

  try {
    await listen(server);
    const port = readServerPort(server);
    const runtime = createLlamaCppRuntime({
      enabled: true,
      executablePath: files.executablePath,
      modelPath: files.modelPath,
      host: "127.0.0.1",
      port,
      ctxSize: 1024,
      alias: "ai-desktop-pet-local",
      startupTimeoutMs: 1_000,
      healthPollIntervalMs: 20
    }, { spawn: fake.spawn });
    const summary = await runtime.start();
    const call = fake.calls[0];

    assert.ok(call);
    assert.equal(summary.status, "ready");
    assert.equal(call.command, files.executablePath);
    assert.deepEqual(call.args, buildLlamaCppSpawnArgs({
      modelPath: files.modelPath,
      host: "127.0.0.1",
      port,
      ctxSize: 1024,
      alias: "ai-desktop-pet-local"
    }));
    assert.equal(call.options.shell, false);
    assert.equal(call.options.windowsHide, true);
    assert.deepEqual(call.options.stdio, ["ignore", "pipe", "pipe"]);
    assert.equal(JSON.stringify(summary).includes(files.root), false);
    assert.equal(JSON.stringify(summary).includes(files.executablePath), false);
    assert.equal(JSON.stringify(summary).includes(files.modelPath), false);
    await runtime.stop();
  } finally {
    await close(server);
    files.cleanup();
  }
});

test("ready runtime start is idempotent and stop is repeatable", async () => {
  const files = createTempRuntimeFiles();
  const server = createHealthServer();
  const fake = createFakeSpawn();

  try {
    await listen(server);
    const runtime = createLlamaCppRuntime({
      enabled: true,
      executablePath: files.executablePath,
      modelPath: files.modelPath,
      port: readServerPort(server),
      startupTimeoutMs: 1_000,
      healthPollIntervalMs: 20
    }, { spawn: fake.spawn });

    const firstStart = await runtime.start();
    const secondStart = await runtime.start();
    const firstStop = await runtime.stop();
    const secondStop = await runtime.stop();

    assert.equal(firstStart.status, "ready");
    assert.equal(secondStart.status, "ready");
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]?.child.killed, true);
    assert.equal(firstStop.status, "exited");
    assert.equal(secondStop.status, "exited");
  } finally {
    await close(server);
    files.cleanup();
  }
});

test("stop timeout escalates the retained child process tree before returning", async () => {
  const files = createTempRuntimeFiles();
  const server = createHealthServer();
  const fake = createFakeSpawn();
  const forcedPids: number[] = [];

  try {
    await listen(server);
    const runtime = createLlamaCppRuntime({
      enabled: true,
      executablePath: files.executablePath,
      modelPath: files.modelPath,
      port: readServerPort(server),
      startupTimeoutMs: 1_000,
      stopTimeoutMs: 10,
      healthPollIntervalMs: 20
    }, {
      spawn: fake.spawn,
      async forceKillProcessTree(pid) {
        forcedPids.push(pid);
        fake.calls[0]?.child.emit("close", null, "SIGKILL");
      }
    });
    await runtime.start();
    fake.calls[0]!.child.kill = function killWithoutClose(): boolean {
      this.killed = true;
      return true;
    };

    const summary = await runtime.stop();

    assert.deepEqual(forcedPids, [4321]);
    assert.equal(summary.status, "exited");
    assert.equal(summary.reason, undefined);
  } finally {
    await close(server);
    files.cleanup();
  }
});

test("concurrent stops terminate the same child process tree only once", async () => {
  const files = createTempRuntimeFiles();
  const server = createHealthServer();
  const fake = createFakeSpawn();
  const forcedPids: number[] = [];

  try {
    await listen(server);
    const runtime = createLlamaCppRuntime({
      enabled: true,
      executablePath: files.executablePath,
      modelPath: files.modelPath,
      port: readServerPort(server),
      startupTimeoutMs: 1_000,
      stopTimeoutMs: 10,
      healthPollIntervalMs: 20
    }, {
      spawn: fake.spawn,
      async forceKillProcessTree(pid) {
        forcedPids.push(pid);
        await new Promise((resolve) => setImmediate(resolve));
        fake.calls[0]?.child.emit("close", null, "SIGKILL");
      }
    });
    await runtime.start();
    const child = fake.calls[0]!.child;
    let killCalls = 0;
    child.kill = function killWithoutClose(): boolean {
      killCalls += 1;
      this.killed = true;
      return true;
    };

    const firstStop = runtime.stop();
    const secondStop = runtime.stop();
    const [firstSummary, secondSummary] = await Promise.all([firstStop, secondStop]);

    assert.equal(killCalls, 1);
    assert.deepEqual(forcedPids, [4321]);
    assert.equal(firstSummary.status, "exited");
    assert.equal(secondSummary.status, "exited");
  } finally {
    await close(server);
    files.cleanup();
  }
});

test("concurrent stops finish when forced process-tree termination never settles", async () => {
  const files = createTempRuntimeFiles();
  const server = createHealthServer();
  const fake = createFakeSpawn();
  const forcedPids: number[] = [];

  try {
    await listen(server);
    const runtime = createLlamaCppRuntime({
      enabled: true,
      executablePath: files.executablePath,
      modelPath: files.modelPath,
      port: readServerPort(server),
      startupTimeoutMs: 1_000,
      stopTimeoutMs: 10,
      healthPollIntervalMs: 20
    }, {
      spawn: fake.spawn,
      forceKillProcessTree(pid) {
        forcedPids.push(pid);
        return new Promise<void>(() => undefined);
      }
    });
    await runtime.start();
    const child = fake.calls[0]!.child;
    let killCalls = 0;
    child.kill = function killWithoutClose(): boolean {
      killCalls += 1;
      this.killed = true;
      return true;
    };

    const firstStop = runtime.stop();
    const secondStop = runtime.stop();
    const summaries = await rejectIfPendingAfter(
      Promise.all([firstStop, secondStop]),
      250,
      "stop did not settle"
    );

    assert.equal(killCalls, 1);
    assert.deepEqual(forcedPids, [4321]);
    assert.equal(summaries[0].status, "timeout");
    assert.equal(summaries[0].reason, "stop_timeout");
    assert.deepEqual(summaries[1], summaries[0]);
  } finally {
    await close(server);
    files.cleanup();
  }
});

test("child exit before health ready is reported without raw process output", async () => {
  const files = createTempRuntimeFiles();
  const fake = createFakeSpawn((child) => {
    child.stderr.write("raw stderr should only be counted");
    queueMicrotask(() => {
      child.emit("close", 1, null);
    });
  });

  try {
    const runtime = createLlamaCppRuntime({
      enabled: true,
      executablePath: files.executablePath,
      modelPath: files.modelPath,
      port: 9,
      startupTimeoutMs: 500,
      healthPollIntervalMs: 20
    }, { spawn: fake.spawn });
    const summary = await runtime.start();
    const safeSummary = JSON.stringify(summary);

    assert.equal(summary.status, "exited");
    assert.equal(summary.exitCode, 1);
    assert.equal(summary.stderrBytes, "raw stderr should only be counted".length);
    assert.equal(safeSummary.includes("raw stderr"), false);
  } finally {
    files.cleanup();
  }
});

function createFakeSpawn(onSpawn?: (child: FakeChild) => void): {
  calls: SpawnCall[];
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess;
} {
  const calls: SpawnCall[] = [];

  return {
    calls,
    spawn(command, args, options) {
      const child = new FakeChild();
      calls.push({ command, args, options, child });
      onSpawn?.(child);
      return child as unknown as ChildProcess;
    }
  };
}

function rejectIfPendingAfter<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function createTempRuntimeFiles(): {
  root: string;
  executablePath: string;
  modelPath: string;
  invalidModelPath: string;
  cleanup(): void;
} {
  const root = mkdtempSync(join(tmpdir(), "ai-desktop-pet-llama-cpp-"));
  const executablePath = join(root, "llama-server.exe");
  const modelPath = join(root, "model.gguf");
  const invalidModelPath = join(root, "model.bin");
  writeFileSync(executablePath, "fake exe", "utf8");
  writeFileSync(modelPath, "fake model", "utf8");

  return {
    root,
    executablePath,
    modelPath,
    invalidModelPath,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function createHealthServer(): Server {
  return createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404);
      response.end();
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
  });
}

function readServerPort(server: Server): number {
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  return address.port;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
