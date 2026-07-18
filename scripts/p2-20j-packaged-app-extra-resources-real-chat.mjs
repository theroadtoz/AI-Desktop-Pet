import { existsSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertSafeP2_20JTmpRoot,
  getP2_20JPaths,
  getRepoRoot,
  stageElectronBuilderLocalLlmExtraResources
} from "./p2-20j-stage-electron-builder-extra-resources.mjs";

const require = createRequire(import.meta.url);
const runtimeName = "llama.cpp";
const defaultAlias = "ai-desktop-pet-local";
const chatTimeoutMs = 90_000;
const modelsTimeoutMs = 10_000;
const keepTmpEnv = "P2_20J_KEEP_TMP";
const questions = [
  "用一句话回答：现在是哪一天？",
  "用一句话回答：水在标准大气压下通常多少摄氏度沸腾？",
  "用一句话回答：在这个应用里，你应保持老魔女桌宠人设，还是普通聊天助手人设？"
];
const systemMessage = {
  role: "system",
  content: "你是 Windows Live2D AI 桌宠里的老魔女角色，不是普通聊天助手。当前日期是 2026-07-02，星期四。回答要简短，并直接对应问题。"
};

export function shouldKeepP2_20JTmp(env = process.env) {
  return env[keepTmpEnv] === "1";
}

export function cleanupP2_20JTmpOnCompletion(paths = getP2_20JPaths(), env = process.env) {
  if (shouldKeepP2_20JTmp(env)) {
    return {
      cleanupStatus: "kept"
    };
  }

  assertSafeP2_20JTmpRoot(paths.stagingRoot);
  assertSafeP2_20JTmpRoot(paths.packageOutputRoot);
  rmSync(paths.stagingRoot, { recursive: true, force: true });
  rmSync(paths.packageOutputRoot, { recursive: true, force: true });

  return {
    cleanupStatus: "removed"
  };
}

export function findElectronBuilderPackagedResourcesPath(packageOutputRoot) {
  const direct = join(packageOutputRoot, "win-unpacked", "resources");

  if (hasPackagedLocalLlm(direct)) {
    return direct;
  }

  return findResourcesPathWithLocalLlm(packageOutputRoot, 4);
}

async function main() {
  const repoRoot = getRepoRoot();
  const paths = getP2_20JPaths(repoRoot);
  const summary = await runAcceptance(repoRoot, paths);
  const cleanup = cleanupP2_20JTmpOnCompletion(paths);

  printSummary({
    ...summary,
    cleanupStatus: cleanup.cleanupStatus
  });
}

async function runAcceptance(repoRoot, paths) {
  const startedAt = Date.now();
  let runtime = null;
  let stopSummary = null;
  let stagedThisRun = false;
  let packagedThisRun = false;

  try {
    const stageResult = await stageElectronBuilderLocalLlmExtraResources({ repoRoot });
    stagedThisRun = stageResult.ok;

    if (!stageResult.ok) {
      return {
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        reason: "electron_builder_extra_resources_stage_failed",
        stageStatus: stageResult.summary.status,
        stageReason: stageResult.summary.reason,
        durationMs: Date.now() - startedAt
      };
    }

    assertSafeP2_20JTmpRoot(paths.packageOutputRoot, repoRoot);
    rmSync(paths.packageOutputRoot, { recursive: true, force: true });

    const packageResult = runPackageWinDir(repoRoot);
    packagedThisRun = packageResult.status === 0;

    if (packageResult.status !== 0) {
      return {
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        reason: "package_win_dir_failed",
        packageExitCode: packageResult.status,
        packageErrorCode: packageResult.error?.code,
        packageStdoutBytes: Buffer.byteLength(packageResult.stdout ?? ""),
        packageStderrBytes: Buffer.byteLength(packageResult.stderr ?? ""),
        stagedThisRun,
        packagedThisRun,
        durationMs: Date.now() - startedAt
      };
    }

    const packageResourcesPath = findElectronBuilderPackagedResourcesPath(paths.packageOutputRoot);

    if (!packageResourcesPath) {
      return {
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        reason: "packaged_resources_missing",
        stagedThisRun,
        packagedThisRun,
        durationMs: Date.now() - startedAt
      };
    }

    const modules = loadRuntimeModules(repoRoot);

    if (!modules.ok) {
      return {
        ok: false,
        status: "script_failed",
        runtime: runtimeName,
        reason: modules.reason,
        stagedThisRun,
        packagedThisRun,
        packageAppDirName: basename(dirname(packageResourcesPath)),
        packageResourcesName: basename(packageResourcesPath),
        durationMs: Date.now() - startedAt
      };
    }

    const resolved = modules.resolveBundledLlamaCppRuntime({
      env: {},
      cwd: join(paths.packageOutputRoot, "unrelated-cwd"),
      resourcesPath: packageResourcesPath
    });

    if (resolved.safeSummary.resourceSource !== "packaged") {
      return {
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        reason: "resolver_source_not_packaged",
        resourceSource: resolved.safeSummary.resourceSource,
        resourceRootName: resolved.safeSummary.resourceRootName,
        stagedThisRun,
        packagedThisRun,
        packageAppDirName: basename(dirname(packageResourcesPath)),
        packageResourcesName: basename(packageResourcesPath),
        durationMs: Date.now() - startedAt
      };
    }

    if (!resolved.config) {
      return {
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        reason: resolved.safeSummary.reason ?? resolved.safeSummary.status,
        resourceSource: resolved.safeSummary.resourceSource,
        resourceRootName: resolved.safeSummary.resourceRootName,
        manifestFound: resolved.safeSummary.manifestFound,
        executableConfigured: resolved.safeSummary.executableConfigured,
        modelConfigured: resolved.safeSummary.modelConfigured,
        alias: resolved.safeSummary.alias ?? defaultAlias,
        stagedThisRun,
        packagedThisRun,
        packageAppDirName: basename(dirname(packageResourcesPath)),
        packageResourcesName: basename(packageResourcesPath),
        durationMs: Date.now() - startedAt
      };
    }

    runtime = modules.createLlamaCppRuntime(resolved.config);
    const startSummary = await runtime.start();
    const baseURL = runtime.getBaseURL();
    let modelsCheck = null;
    let rounds = [];

    if (startSummary.status === "ready" && baseURL) {
      modelsCheck = await checkModels(baseURL, resolved.config.alias ?? defaultAlias);

      if (modelsCheck.status === "ready") {
        rounds = await runChatRounds(baseURL, resolved.config.alias ?? defaultAlias);
      }
    }

    const chatReady = rounds.length === questions.length && rounds.every((round) => round.status === "ready");
    const status = startSummary.status !== "ready"
      ? startSummary.status
      : modelsCheck?.status !== "ready"
        ? modelsCheck?.status ?? "model_check_skipped"
        : chatReady ? "ready" : "chat_failed";
    const ok = status === "ready";

    if (runtime) {
      stopSummary = await runtime.stop();
      runtime = null;
    }

    return {
      ok,
      status,
      runtime: runtimeName,
      resourceSource: resolved.safeSummary.resourceSource,
      resourceRootName: resolved.safeSummary.resourceRootName,
      packageAppDirName: basename(dirname(packageResourcesPath)),
      packageResourcesName: basename(packageResourcesPath),
      baseURLHost: startSummary.baseURLHost,
      alias: resolved.config.alias ?? defaultAlias,
      startupMs: startSummary.startupMs,
      durationMs: Date.now() - startedAt,
      modelsStatus: modelsCheck?.status,
      modelCount: modelsCheck?.modelCount,
      rounds,
      reason: startSummary.reason ?? modelsCheck?.reason ?? rounds.find((round) => round.status !== "ready")?.reason,
      exitCode: stopSummary?.exitCode ?? startSummary.exitCode,
      stagedThisRun,
      packagedThisRun
    };
  } finally {
    if (runtime) {
      await runtime.stop();
    }
  }
}

function runPackageWinDir(repoRoot) {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd run package:win:dir"]
    : ["run", "package:win:dir"];

  return spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
}

function loadRuntimeModules(repoRoot) {
  try {
    const bundledModule = require(join(repoRoot, "dist", "main", "services", "local-runtime", "bundled-llama-cpp-runtime.js"));
    const runtimeModule = require(join(repoRoot, "dist", "main", "services", "local-runtime", "llama-cpp-runtime.js"));

    return {
      ok: true,
      resolveBundledLlamaCppRuntime: bundledModule.resolveBundledLlamaCppRuntime,
      createLlamaCppRuntime: runtimeModule.createLlamaCppRuntime
    };
  } catch {
    return {
      ok: false,
      reason: "dist_runtime_missing"
    };
  }
}

async function runChatRounds(baseURL, alias) {
  const history = [systemMessage];
  const rounds = [];
  const replyFingerprints = new Set();

  for (let index = 0; index < questions.length; index += 1) {
    history.push({ role: "user", content: questions[index] });
    const result = await checkChat(baseURL, alias, history, index, replyFingerprints);
    rounds.push({
      round: index + 1,
      status: result.status,
      relevanceStatus: result.relevanceStatus,
      replyLength: result.replyLength,
      firstTokenMs: result.firstTokenMs,
      durationMs: result.durationMs,
      reason: result.reason
    });

    if (result.status !== "ready") {
      break;
    }

    history.push({ role: "assistant", content: result.safeContext });
  }

  return rounds;
}

async function checkModels(baseURL, alias) {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(createModelsURL(baseURL), {
      method: "GET",
      headers: { Accept: "application/json" }
    }, modelsTimeoutMs);

    if (!response.ok) {
      return {
        status: "service_unreachable",
        durationMs: Date.now() - startedAt,
        reason: `models_http_${response.status}`
      };
    }

    const modelIds = parseModelIds(await response.json());

    if (!modelIds) {
      return {
        status: "incompatible_response",
        durationMs: Date.now() - startedAt,
        reason: "models_response_incompatible"
      };
    }

    return {
      status: modelIds.includes(alias) ? "ready" : "model_missing",
      durationMs: Date.now() - startedAt,
      modelCount: modelIds.length
    };
  } catch (error) {
    return {
      status: "service_unreachable",
      durationMs: Date.now() - startedAt,
      reason: classifyFetchError(error)
    };
  }
}

async function checkChat(baseURL, alias, history, roundIndex, replyFingerprints) {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(createChatCompletionsURL(baseURL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: alias,
        messages: history,
        chat_template_kwargs: { enable_thinking: false },
        temperature: 0.3,
        max_tokens: 96,
        stream: true
      })
    }, chatTimeoutMs);

    if (!response.ok || !response.body) {
      return {
        status: "chat_failed",
        relevanceStatus: "not_checked",
        durationMs: Date.now() - startedAt,
        reason: `chat_http_${response.status}`
      };
    }

    const stream = await readSseSummary(response.body, startedAt);
    const relevanceStatus = evaluateRoundRelevance(roundIndex, stream.replyForCheck, replyFingerprints);
    const ready = stream.replyLength > 0 && relevanceStatus === "matched";

    return {
      status: ready ? "ready" : "chat_failed",
      relevanceStatus,
      durationMs: Date.now() - startedAt,
      firstTokenMs: stream.firstTokenMs,
      replyLength: stream.replyLength,
      safeContext: "[previous reply was relevant and non-empty]",
      reason: ready
        ? undefined
        : stream.replyLength > 0
          ? relevanceStatus
          : stream.sawEvent ? "empty_chat_stream" : "incompatible_chat_stream"
    };
  } catch (error) {
    return {
      status: "chat_failed",
      relevanceStatus: "not_checked",
      durationMs: Date.now() - startedAt,
      reason: classifyFetchError(error)
    };
  }
}

async function readSseSummary(body, startedAt) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstTokenMs;
  let replyLength = 0;
  let replyForCheck = "";
  let sawEvent = false;

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const data = trimmed.slice("data:".length).trim();

        if (data === "[DONE]") {
          return { firstTokenMs, replyLength, replyForCheck, sawEvent: true };
        }

        sawEvent = true;
        const parsed = parseJson(data);
        const text = parsed?.choices?.[0]?.delta?.content;

        if (typeof text === "string" && text.length > 0) {
          firstTokenMs ??= Date.now() - startedAt;
          replyLength += text.length;
          replyForCheck = `${replyForCheck}${text}`.slice(-400);
        }
      }
    }

    return { firstTokenMs, replyLength, replyForCheck, sawEvent };
  } finally {
    reader.releaseLock();
  }
}

function findResourcesPathWithLocalLlm(root, depth) {
  if (depth < 0 || !existsSync(root)) {
    return null;
  }

  let entries;

  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const entryPath = join(root, entry.name);

    if (entry.name === "resources" && hasPackagedLocalLlm(entryPath)) {
      return entryPath;
    }

    const nested = findResourcesPathWithLocalLlm(entryPath, depth - 1);

    if (nested) {
      return nested;
    }
  }

  return null;
}

function hasPackagedLocalLlm(resourcesPath) {
  return existsSync(join(resourcesPath, "local-llm", "manifest.json"));
}

function evaluateRoundRelevance(roundIndex, reply, replyFingerprints) {
  const normalized = normalizeText(reply);

  if (!normalized) {
    return "empty";
  }

  const fingerprint = normalized.slice(0, 120);

  if (replyFingerprints.has(fingerprint)) {
    return "fixed_or_repeated_reply";
  }

  replyFingerprints.add(fingerprint);

  if (roundIndex === 0) {
    return /2026|7月2|七月二|星期四|周四/.test(normalized) ? "matched" : "date_mismatch";
  }

  if (roundIndex === 1) {
    return /100|一百|沸点|摄氏/.test(normalized) ? "matched" : "common_sense_mismatch";
  }

  return /桌宠|魔女|老魔女|live2d|陪伴|角色|人设|应用/.test(normalized) ? "matched" : "persona_mismatch";
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function createModelsURL(value) {
  const url = new URL(value);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/models`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

function createChatCompletionsURL(value) {
  const url = new URL(value);
  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${basePath}/chat/completions`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

function parseModelIds(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.data)) {
    return null;
  }

  const ids = [];

  for (const item of value.data) {
    const id = item && typeof item === "object"
      ? item.id ?? item.model ?? item.name
      : null;

    if (typeof id !== "string" || id.length === 0) {
      return null;
    }

    ids.push(id);
  }

  return ids;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function classifyFetchError(error) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }

  return "network_or_runtime_unreachable";
}

function normalizeText(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/\s+/g, "")
    : "";
}

function printSummary(summary) {
  if (summary.ok === false) {
    process.exitCode = 1;
  }

  console.log(JSON.stringify(stripUnsafeStrings(removeUndefined({
    ...summary,
    resourceRootName: summary.resourceRootName ? basename(summary.resourceRootName) : undefined,
    safeSummaryOnly: true
  })), null, 2));
}

function stripUnsafeStrings(value) {
  if (Array.isArray(value)) {
    return value.map(stripUnsafeStrings);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      typeof entryValue === "string" && /[A-Za-z]:\\/.test(entryValue)
        ? basename(entryValue)
        : stripUnsafeStrings(entryValue)
    ])
  );
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => typeof entryValue !== "undefined")
      .map(([key, entryValue]) => [key, removeUndefined(entryValue)])
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const cleanup = cleanupP2_20JTmpOnCompletion();
    printSummary({
      ok: false,
      status: "script_failed",
      runtime: runtimeName,
      safeSummaryOnly: true,
      reason: error instanceof Error ? error.name : "unexpected_error",
      cleanupStatus: cleanup.cleanupStatus
    });
    process.exitCode = 1;
  });
}
