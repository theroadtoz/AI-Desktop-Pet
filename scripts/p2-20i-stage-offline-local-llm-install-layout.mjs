import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export const sourceRootEnv = "AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT";
export const bundledRootEnv = "AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT";
export const installLayoutRootName = "p2-20i-install-layout";

const runtimeName = "llama.cpp";

export function getRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function getInstallLayoutPaths(repoRoot = getRepoRoot()) {
  const tmpRoot = resolve(repoRoot, ".tmp");
  const stagingRoot = join(tmpRoot, installLayoutRootName);
  const resourcesPath = join(stagingRoot, "resources");
  const localLlmRoot = join(resourcesPath, "local-llm");

  return {
    tmpRoot,
    stagingRoot,
    resourcesPath,
    localLlmRoot
  };
}

export function assertSafeInstallLayoutRoot(candidateRoot, repoRoot = getRepoRoot()) {
  const tmpRoot = resolve(repoRoot, ".tmp");
  const resolvedRoot = resolve(candidateRoot);
  const tmpPrefix = tmpRoot.endsWith(sep) ? tmpRoot : `${tmpRoot}${sep}`;

  if (resolvedRoot !== tmpRoot && !resolvedRoot.startsWith(tmpPrefix)) {
    throw new Error("install_layout_destination_outside_repo_tmp");
  }
}

export async function stageOfflineLocalLlmInstallLayout(options = {}) {
  const startedAt = Date.now();
  const repoRoot = options.repoRoot ? resolve(options.repoRoot) : getRepoRoot();
  const env = options.env ?? process.env;
  const source = resolveSourceRoot(repoRoot, env);
  const paths = getInstallLayoutPaths(repoRoot);

  assertSafeInstallLayoutRoot(paths.stagingRoot, repoRoot);

  const validation = runP2_20HValidator(repoRoot, source.root);

  if (!validation.ok) {
    return {
      ok: false,
      summary: removeUndefined({
        ok: false,
        status: "blocked",
        runtime: runtimeName,
        safeSummaryOnly: true,
        reason: "source_validation_failed",
        sourceKind: source.kind,
        sourceRootName: basename(source.root),
        destinationRootName: basename(paths.stagingRoot),
        validatorStatus: validation.summary?.status,
        validatorReason: validation.summary?.reason,
        manifestFound: validation.summary?.manifestFound,
        durationMs: Date.now() - startedAt
      })
    };
  }

  rmSync(paths.stagingRoot, { recursive: true, force: true });
  mkdirSync(dirname(paths.localLlmRoot), { recursive: true });
  cpSync(source.root, paths.localLlmRoot, {
    recursive: true,
    force: true,
    errorOnExist: false
  });

  const fileCounts = countFiles(paths.localLlmRoot);
  const validatorSummary = validation.summary ?? {};

  return {
    ok: true,
    summary: removeUndefined({
      ok: true,
      status: "ready",
      runtime: runtimeName,
      safeSummaryOnly: true,
      sourceKind: source.kind,
      sourceRootName: basename(source.root),
      destinationRootName: basename(paths.stagingRoot),
      destinationLocalLlmName: basename(paths.localLlmRoot),
      fileCount: fileCounts.fileCount,
      directoryCount: fileCounts.directoryCount,
      executableName: validatorSummary.executableName,
      modelName: validatorSummary.modelName,
      runtimeIntegrity: validatorSummary.runtimeIntegrity,
      modelIntegrity: validatorSummary.modelIntegrity,
      licenseNotices: validatorSummary.licenseNotices,
      durationMs: Date.now() - startedAt
    })
  };
}

function resolveSourceRoot(repoRoot, env) {
  const sourceRoot = readNonEmpty(env[sourceRootEnv]);

  if (sourceRoot) {
    return {
      root: resolve(process.cwd(), sourceRoot),
      kind: "localSourceEnv"
    };
  }

  const bundledRoot = readNonEmpty(env[bundledRootEnv]);

  if (bundledRoot) {
    return {
      root: resolve(process.cwd(), bundledRoot),
      kind: "bundledEnv"
    };
  }

  return {
    root: join(repoRoot, "resources", "local-llm"),
    kind: "repoDefault"
  };
}

function runP2_20HValidator(repoRoot, sourceRoot) {
  const validatorPath = join(repoRoot, "scripts", "p2-20h-validate-local-llm-resources.mjs");
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: repoRoot,
    env: createChildEnv({
      [sourceRootEnv]: sourceRoot
    }),
    encoding: "utf8"
  });
  const summary = parseJson(result.stdout);

  return {
    ok: result.status === 0 && summary?.status === "ready",
    status: result.status,
    summary
  };
}

function countFiles(root) {
  let fileCount = 0;
  let directoryCount = 0;

  if (!existsSync(root)) {
    return { fileCount, directoryCount };
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);

    if (entry.isDirectory()) {
      directoryCount += 1;
      const nested = countFiles(entryPath);
      fileCount += nested.fileCount;
      directoryCount += nested.directoryCount;
      continue;
    }

    if (entry.isFile()) {
      fileCount += 1;
    }
  }

  return { fileCount, directoryCount };
}

function createChildEnv(extra) {
  const env = {};

  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec"]) {
    if (typeof process.env[key] === "string") {
      env[key] = process.env[key];
    }
  }

  return {
    ...env,
    ...extra
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function printSummary(summary) {
  if (summary.ok === false) {
    process.exitCode = 1;
  }

  console.log(JSON.stringify(stripUnsafeStrings(removeUndefined(summary)), null, 2));
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
  stageOfflineLocalLlmInstallLayout()
    .then((result) => printSummary(result.summary))
    .catch((error) => {
      printSummary({
        ok: false,
        status: "script_failed",
        runtime: runtimeName,
        safeSummaryOnly: true,
        reason: error instanceof Error && error.message === "install_layout_destination_outside_repo_tmp"
          ? error.message
          : error instanceof Error ? error.name : "unexpected_error"
      });
      process.exitCode = 1;
    });
}
