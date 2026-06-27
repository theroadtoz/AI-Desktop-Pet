import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runParentDir = join(root, ".tmp", "p2-11g-real-ui-regression-runner");
const runDir = join(runParentDir, stamp);
const resultPath = join(runDir, "result.json");
const childTimeoutMs = Number(process.env.P2_11G_CHILD_TIMEOUT_MS || 300_000);

const smokeScripts = [
  {
    id: "P2-10C",
    script: "scripts/p2-10c-chat-mode-switching-real-ui.mjs",
    reason: "chat mode switching and memory privacy"
  },
  {
    id: "P2-11D",
    script: "scripts/p2-11d-chat-ui-polish-real-ui.mjs",
    reason: "chat UI polish and density checks"
  },
  {
    id: "P2-11E",
    script: "scripts/p2-11e-companion-control-shelf-real-ui.mjs",
    reason: "companion control shelf"
  }
];

const extendedScripts = [
  {
    id: "P2-5E",
    script: "scripts/p2-5e-accessory-selector-real-ui.mjs",
    reason: "accessory selector"
  },
  {
    id: "P2-9A",
    script: "scripts/p2-9a-custom-shortcuts-real-ui.mjs",
    reason: "global lock shortcut; must run serially"
  },
  {
    id: "P2-9B",
    script: "scripts/p2-9b-custom-scale-wheel-shortcut-real-ui.mjs",
    reason: "global scale wheel shortcut; must run serially"
  }
];

function parseOption(name) {
  const optionIndex = process.argv.indexOf(name);
  if (optionIndex !== -1) {
    return process.argv[optionIndex + 1] || "smoke";
  }

  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  return null;
}

function parseScope() {
  const scope = parseOption("--scope");
  if (scope) {
    return scope;
  }

  const mode = parseOption("--mode");
  if (mode) {
    return mode;
  }

  return "smoke";
}

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

function matchesTmpResidue(name, scope) {
  const common = [/^p2-10c-/i, /^p2-11d-/i, /^p2-11e-/i, /^p2-11g-/i];
  const extended = [/^p2-5e-/i, /^p2-9a-/i, /^p2-9b-/i];
  return [...common, ...(scope === "extended" ? extended : [])].some((pattern) => pattern.test(name));
}

function findTmpResidue(scope) {
  return listEntries(join(root, ".tmp"))
    .filter((entry) => entry.isDirectory && entry.path !== runParentDir && matchesTmpResidue(entry.name, scope))
    .map((entry) => toRelativePath(entry.path))
    .sort();
}

function findKnownOldTmpDirs() {
  return ["p2-6g-memory-productization-review", "p2-7d-runtime-resource-optimization"]
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

    if (/^(screenshot.*|screen|p2-11g-.*)\.png$/i.test(entry.name)) {
      matches.push(toRelativePath(fullPath));
    }
  }

  return matches.sort();
}

function sanitize(text) {
  return text
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]")
    .replace(/P2-[0-9A-Z-]+\s*用户正文哨兵/g, "[REDACTED_USER_SENTINEL]")
    .replace(/P2-[0-9A-Z-]+\s*事实卡正文哨兵/g, "[REDACTED_MEMORY_SENTINEL]")
    .replace(/provider request body/gi, "[REDACTED_PROVIDER_BODY]")
    .replace(/完整 prompt/gi, "[REDACTED_PROMPT]");
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
    line.startsWith("Error") ||
    line.includes("failed")
  ));
  const selected = (useful.length > 0 ? useful : lines).slice(-5);
  return selected.map((line) => line.slice(0, 600));
}

function runChild(item) {
  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [item.script], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false
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
      const durationMs = Date.now() - startedAt;
      resolveRun({
        id: item.id,
        script: item.script,
        reason: item.reason,
        exitCode,
        signal,
        timedOut,
        durationMs,
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

async function main() {
  const scope = parseScope();
  if (!["smoke", "extended"].includes(scope)) {
    throw new Error(`Unsupported scope: ${scope}. Use --scope smoke, --mode smoke, or extended.`);
  }

  mkdirSync(runDir, { recursive: true });

  const scripts = scope === "extended" ? [...smokeScripts, ...extendedScripts] : smokeScripts;
  const beforeTmpResidue = findTmpResidue(scope);
  const beforeScreenshotResidue = findScreenshotResidue();
  const results = [];

  for (const item of scripts) {
    console.log(`[p2-11g] running ${item.id}: ${item.script}`);
    const result = await runChild(item);
    results.push(result);
    console.log(`[p2-11g] ${item.id} exit=${result.exitCode} durationMs=${result.durationMs}`);
    if (result.exitCode !== 0 || result.timedOut) {
      break;
    }
  }

  const passed = results.length === scripts.length && results.every((result) => result.exitCode === 0 && !result.timedOut);
  const afterTmpResidueBeforeCleanup = findTmpResidue(scope);
  const newTmpRemoved = passed ? removeNewTmpDirs(beforeTmpResidue, afterTmpResidueBeforeCleanup) : [];
  const afterTmpResidue = findTmpResidue(scope);
  const afterScreenshotResidue = findScreenshotResidue();
  const summary = {
    ok: passed && afterTmpResidue.length === 0 && afterScreenshotResidue.length === 0,
    scope,
    serialExecution: true,
    childTimeoutMs,
    runDir: toRelativePath(runDir),
    order: scripts.map((item) => item.id),
    results,
    tmpResidue: {
      before: beforeTmpResidue,
      afterBeforeCleanup: afterTmpResidueBeforeCleanup,
      removedThisRun: newTmpRemoved,
      after: afterTmpResidue,
      knownOldPreserved: findKnownOldTmpDirs()
    },
    runnerTmp: {
      path: toRelativePath(runParentDir),
      cleanedOnSuccess: process.env.P2_11G_KEEP_TMP !== "1"
    },
    screenshotResidue: {
      before: beforeScreenshotResidue,
      after: afterScreenshotResidue
    }
  };

  writeFileSync(resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));

  if (process.env.P2_11G_KEEP_TMP !== "1" && summary.ok) {
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
    error: error instanceof Error ? error.message : String(error),
    runDir: toRelativePath(runDir)
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.error(error);
  process.exitCode = 1;
});
