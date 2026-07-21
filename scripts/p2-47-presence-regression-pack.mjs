import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runParentDir = join(root, ".tmp", "p2-47-presence-regression-pack");
const runDir = join(runParentDir, stamp);
const resultPath = join(runDir, "result.json");
const childTimeoutMs = Number(process.env.P2_47_CHILD_TIMEOUT_MS || 360_000);

const scripts = [
  {
    id: "P2-25B",
    script: "scripts/p2-25b-edge-positioning-half-body-presence-real-ui.mjs",
    reason: "edge positioning and half-body desktop presence"
  },
  {
    id: "P2-34",
    script: "scripts/p2-34-companion-presence-idle-mode-cadence-real-ui.mjs",
    reason: "startup idle mode focus quiet sleep and chat-open cadence",
    env: {
      P2_34_IDLE_INTERVAL_MS: "850",
      P2_34_LOW_FREQUENCY_MINIMUM_INTERVAL_MS: "250"
    }
  },
  {
    id: "P2-45",
    script: "scripts/p2-45-proactive-bubble-action-expression-linkage-real-ui.mjs",
    reason: "sourced proactive bubble action and expression linkage"
  },
  {
    id: "P2-46",
    script: "scripts/p2-46-proactive-bubble-frequency-user-control-real-ui.mjs",
    reason: "proactive bubble cadence source toggles and runtime off clearing"
  }
];

function toRelativePath(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function listEntries(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    path: join(directory, entry.name),
    isDirectory: entry.isDirectory()
  }));
}

function matchesTmpResidue(name) {
  return [
    /^p2-25b-/i,
    /^p2-34-/i,
    /^p2-45-/i,
    /^p2-46-/i,
    /^p2-47-/i
  ].some((pattern) => pattern.test(name));
}

function findTmpResidue() {
  return listEntries(join(root, ".tmp"))
    .filter((entry) => entry.isDirectory && entry.path !== runParentDir && matchesTmpResidue(entry.name))
    .map((entry) => toRelativePath(entry.path))
    .sort();
}

function findKnownOldTmpDirs() {
  return ["p2-23c-qwen25-15b-local-llm", "p2-7d-runtime-resource-optimization"]
    .map((name) => join(root, ".tmp", name))
    .filter((path) => existsSync(path))
    .map(toRelativePath);
}

function findScreenshotResidue(directory = root, matches = []) {
  for (const entry of listEntries(directory)) {
    const fullPath = entry.path;
    if (entry.isDirectory) {
      if ([".git", "node_modules", "dist", "dist-renderer"].includes(entry.name)) {
        continue;
      }
      findScreenshotResidue(fullPath, matches);
      continue;
    }

    if (/^(screenshot.*|screen|p2-47-.*)\.png$/i.test(entry.name)) {
      matches.push(toRelativePath(fullPath));
    }
  }

  return matches.sort();
}

function sanitize(text) {
  return text
    .replaceAll(root, "[REDACTED_REPO_PATH]")
    .replace(/[A-Za-z]:[\\/][^\s"]+/g, "[REDACTED_LOCAL_PATH]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]")
    .replace(/P2-[0-9A-Z-]+\s*用户正文哨兵/g, "[REDACTED_USER_SENTINEL]")
    .replace(/P2-[0-9A-Z-]+\s*事实卡正文哨兵/g, "[REDACTED_MEMORY_SENTINEL]")
    .replace(/provider request body/gi, "[REDACTED_PROVIDER_BODY]")
    .replace(/complete prompt|system prompt|完整 prompt/gi, "[REDACTED_PROMPT]");
}

function summarizeOutput(output) {
  const lines = sanitize(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const useful = lines.filter((line) => (
    line.includes("result=") ||
    line.includes("checks=") ||
    line.includes('"ok"') ||
    line.includes('"safeSummaryOnly"') ||
    line.startsWith("Error") ||
    line.includes("failed")
  ));
  const selected = (useful.length > 0 ? useful : lines).slice(-6);
  return selected.map((line) => line.slice(0, 600));
}

function runChild(item) {
  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, ["--no-warnings", item.script], {
      cwd: root,
      env: { ...process.env, ...(item.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, childTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolveRun({
        id: item.id,
        script: item.script,
        reason: item.reason,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdoutSummary: summarizeOutput(stdout),
        stderrSummary: summarizeOutput(stderr)
      });
    });
  });
}

function removeNewTmpDirs(before, after) {
  const beforeSet = new Set(before);
  const removed = [];

  for (const entry of after) {
    if (beforeSet.has(entry)) {
      continue;
    }
    const fullPath = join(root, entry);
    rmSync(fullPath, { recursive: true, force: true });
    removed.push(entry);
  }

  return removed;
}

function isSafeOutput(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return ![
    /\beventId\b/i,
    /safeContextTag|contextTag/i,
    /sk-[A-Za-z0-9]/i,
    /\.env/i,
    /Provider request body|providerRequestBody|requestBody/i,
    /complete prompt|system prompt|prompt/i,
    /providerMessages|messages\W*:/i,
    /userMessage|assistantMessage|messageText|bubbleText|textContent/i,
    /fact card|memory card|factCardBody|memoryCardBody/i,
    /memory title|memory content|history summary/i,
    /search content|search query|search result|safeQuery|snippet|domain|url|title/i,
    /raw MCP|rawMcp/i,
    /apiKey|Authorization/i,
    /motion path|motionPath|expressionName|partId|resourcePath/i,
    /\b[A-Za-z]:[\\/]/
  ].some((pattern) => pattern.test(text));
}

async function main() {
  mkdirSync(runDir, { recursive: true });

  const beforeTmpResidue = findTmpResidue();
  const beforeScreenshotResidue = findScreenshotResidue();
  const results = [];

  for (const item of scripts) {
    console.log(`[p2-47] running ${item.id}: ${item.script}`);
    const result = await runChild(item);
    results.push(result);
    console.log(`[p2-47] ${item.id} exit=${result.exitCode} durationMs=${result.durationMs}`);
    if (result.exitCode !== 0 || result.timedOut) {
      break;
    }
  }

  const allChildrenPassed = results.length === scripts.length &&
    results.every((result) => result.exitCode === 0 && !result.timedOut);
  const afterTmpResidueBeforeCleanup = findTmpResidue();
  const removedThisRun = allChildrenPassed ? removeNewTmpDirs(beforeTmpResidue, afterTmpResidueBeforeCleanup) : [];
  const afterTmpResidue = findTmpResidue();
  const afterScreenshotResidue = findScreenshotResidue();

  const summary = {
    ok: false,
    safeSummaryOnly: true,
    provider: "fake",
    serialExecution: true,
    childTimeoutMs,
    runDir: toRelativePath(runDir),
    order: scripts.map((item) => item.id),
    checks: {
      allChildrenPassed,
      noTargetedTmpResidue: afterTmpResidue.length === 0,
      noScreenshotResidue: afterScreenshotResidue.length === 0
    },
    results,
    tmpResidue: {
      before: beforeTmpResidue,
      afterBeforeCleanup: afterTmpResidueBeforeCleanup,
      removedThisRun,
      after: afterTmpResidue,
      knownOldPreserved: findKnownOldTmpDirs()
    },
    screenshotResidue: {
      before: beforeScreenshotResidue,
      after: afterScreenshotResidue
    }
  };

  summary.checks.privacyOutputSafe = isSafeOutput(summary);
  summary.ok = Object.values(summary.checks).every(Boolean);

  writeFileSync(resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));

  if (process.env.P2_47_KEEP_TMP !== "1" && summary.ok) {
    rmSync(runParentDir, { recursive: true, force: true });
  }

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  mkdirSync(runDir, { recursive: true });
  const result = {
    ok: false,
    safeSummaryOnly: true,
    failureCategory: "runner_failed",
    errorName: error instanceof Error ? error.name : "Error",
    runDir: toRelativePath(runDir)
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
});
