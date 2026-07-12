import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

const CORE_MODULE = "./support/vts-motion-recorder.mts";

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index === args.length - 1 || args[index + 1].startsWith("--")) return undefined;
  return args[index + 1];
}

function validateOptions(args, valueOptions, flagOptions = new Set()) {
  const seen = new Set();
  for (let index = 0; index < args.length;) {
    const option = args[index];
    if (seen.has(option)) throw new Error("usage");
    if (flagOptions.has(option)) {
      seen.add(option);
      index += 1;
      continue;
    }
    if (!valueOptions.has(option) || index + 1 >= args.length || args[index + 1].startsWith("--")) {
      throw new Error("usage");
    }
    seen.add(option);
    index += 2;
  }
}

export function parseVtsRecorderArgs(argv, defaults = {}) {
  const [command, ...args] = argv;
  if (command !== "inspect" && command !== "record") throw new Error("usage");
  validateOptions(
    args,
    command === "inspect"
      ? new Set(["--port"])
      : new Set(["--name", "--duration", "--fps", "--draft-root", "--port"]),
    command === "record" ? new Set(["--confirm-record"]) : new Set()
  );
  const portText = readOption(args, "--port");
  const port = portText === undefined ? 8001 : Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("invalid-port");

  if (command === "inspect") return { command, port };
  const name = readOption(args, "--name");
  const durationSeconds = Number(readOption(args, "--duration"));
  const fpsText = readOption(args, "--fps");
  const fps = fpsText === undefined ? 30 : Number(fpsText);
  const draftRoot = readOption(args, "--draft-root") ?? defaults.draftRoot ?? resolve(process.cwd(), ".tmp", "vts-drafts");
  if (!name || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isInteger(fps)) {
    throw new Error("usage");
  }
  if (fps < 1 || fps > 30) throw new Error("invalid-fps");
  return { command, port, name, durationSeconds, fps, draftRoot, confirmRecord: args.includes("--confirm-record") };
}

const SAFE_ERROR_CODES = new Set([
  "api-state-timeout",
  "authentication-denied",
  "authentication-timeout",
  "authentication-token-timeout",
  "connection-closed",
  "connection-failed",
  "connection-timeout",
  "current-model-timeout",
  "draft-path-escape",
  "invalid-draft-name",
  "invalid-draft-root",
  "invalid-duration",
  "invalid-fps",
  "invalid-parameter-list",
  "invalid-parameter-sample",
  "invalid-port",
  "invalid-vts-response",
  "model-changed",
  "motion-consistency-check-failed",
  "no-model-loaded",
  "no-semantic-gesture-detected",
  "out-of-order-sample",
  "parameter-list-timeout",
  "parameter-set-changed",
  "recording-not-confirmed",
  "request-already-in-flight",
  "request-timeout",
  "semantic-profile-unavailable",
  "vts-api-error",
  "vts-api-inactive",
  "websocket-unavailable"
]);

function safeError(error) {
  if (error && typeof error === "object" && SAFE_ERROR_CODES.has(error.code)) return error.code;
  return "recorder-failed";
}

export async function runVtsMotionRecorderCli(argv, dependencies = {}) {
  const output = dependencies.output ?? ((line) => process.stdout.write(`${line}\n`));
  let adapter;
  let readline;
  try {
    const options = parseVtsRecorderArgs(argv, { draftRoot: dependencies.defaultDraftRoot });
    const core = dependencies.core ?? await import(CORE_MODULE);
    adapter = dependencies.adapter ?? await core.createNodeWebSocketAdapter(options.port, WebSocket);
    if (options.command === "inspect") {
      const summary = await core.inspectVts(adapter, { tokenStore: dependencies.tokenStore });
      output(JSON.stringify(summary));
      return 0;
    }

    const interactiveConfirmStart = dependencies.confirmStart ?? (async () => {
      readline = (dependencies.createInterface ?? createInterface)({ input: process.stdin, output: process.stdout });
      const answer = await readline.question("输入 record 明确开始录制，其他输入取消: ");
      return answer.trim() === "record";
    });
    const baseRuntime = dependencies.runtime ?? {
      now: Date.now,
      sleep: (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
      confirmStart: interactiveConfirmStart,
      onCountdown: (cue) => output(`countdown=${cue}`)
    };
    const runtime = {
      ...baseRuntime,
      confirmStart: options.confirmRecord ? async () => true : baseRuntime.confirmStart,
      onCountdown: async (cue) => {
        await baseRuntime.onCountdown?.(cue);
        await dependencies.overlay?.showCountdown(cue);
      },
      onRecordingStart: async () => {
        await baseRuntime.onRecordingStart?.();
        await dependencies.overlay?.showRecording();
      }
    };
    const result = await core.recordVtsMotion(adapter, {
      durationSeconds: options.durationSeconds,
      fps: options.fps,
      runtime,
      tokenStore: dependencies.tokenStore
    });
    const allowedDraftRoot = dependencies.allowedDraftRoot ?? resolve(process.cwd(), ".tmp");
    const outputPath = await core.writeMotionDraft(options.draftRoot, options.name, result.motion, allowedDraftRoot);
    output(JSON.stringify({ ...result.summary, draftFile: outputPath.split(/[\\/]/).pop() }));
    return 0;
  } catch (error) {
    output(JSON.stringify({ safeSummaryOnly: true, status: "blocked", blocker: safeError(error) }));
    return 1;
  } finally {
    readline?.close();
    try {
      dependencies.overlay?.destroy();
    } catch {
      // Overlay cleanup must not bypass the recorder's sanitized result.
    }
    try {
      await adapter?.close?.();
    } catch {
      // Cleanup errors must not bypass the recorder's sanitized result.
    }
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const exitCode = await runVtsMotionRecorderCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
