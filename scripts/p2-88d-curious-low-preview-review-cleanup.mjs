import { existsSync, lstatSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const RUN_STAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/u;

function assertDirectoryNotReparse(path, errorCode) {
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(errorCode);
}

function resolveFrozenTaskRoot(taskRoot, frozenTaskRoot) {
  if (typeof taskRoot !== "string" || typeof frozenTaskRoot !== "string") {
    throw new Error("unsafe_task_root");
  }
  const resolvedTaskRoot = resolve(taskRoot);
  if (resolvedTaskRoot !== resolve(frozenTaskRoot)) throw new Error("unsafe_task_root");
  return resolvedTaskRoot;
}

function resolveReviewRoot(taskRoot) {
  const reviewRoot = join(taskRoot, "review");
  if (relative(taskRoot, reviewRoot) !== "review" || resolve(reviewRoot) !== resolve(taskRoot, "review")) {
    throw new Error("unsafe_review_root");
  }
  return reviewRoot;
}

function collectKnownEmptyRunStamps(taskRoot, reviewRoot) {
  const emptyRunStamps = [];
  for (const entry of readdirSync(taskRoot, { withFileTypes: true })) {
    const entryPath = join(taskRoot, entry.name);
    if (entry.name === "review") {
      if (resolve(entryPath) !== reviewRoot) throw new Error("unsafe_review_root");
      assertDirectoryNotReparse(entryPath, "unsafe_review_root");
      continue;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink() || !RUN_STAMP_PATTERN.test(entry.name)) return null;
    const stampDir = join(taskRoot, entry.name);
    assertDirectoryNotReparse(stampDir, "unsafe_run_stamp");
    if (readdirSync(stampDir).length !== 0) return null;
    emptyRunStamps.push(stampDir);
  }
  return emptyRunStamps;
}

export function cleanupP288dReviewRoot({ taskRoot, frozenTaskRoot }) {
  const resolvedTaskRoot = resolveFrozenTaskRoot(taskRoot, frozenTaskRoot);
  const reviewRoot = resolveReviewRoot(resolvedTaskRoot);
  if (!existsSync(resolvedTaskRoot)) {
    return { reviewArtifactsCleaned: true, taskRootCleaned: true };
  }

  assertDirectoryNotReparse(resolvedTaskRoot, "unsafe_task_root");
  const emptyRunStamps = collectKnownEmptyRunStamps(resolvedTaskRoot, reviewRoot);
  if (!emptyRunStamps) {
    return { reviewArtifactsCleaned: false, taskRootCleaned: false };
  }
  if (existsSync(reviewRoot)) {
    assertDirectoryNotReparse(reviewRoot, "unsafe_review_root");
    rmSync(reviewRoot, { recursive: true, force: true });
  }
  for (const stampDir of emptyRunStamps) rmdirSync(stampDir);
  if (readdirSync(resolvedTaskRoot).length === 0) rmdirSync(resolvedTaskRoot);

  return {
    reviewArtifactsCleaned: !existsSync(reviewRoot),
    taskRootCleaned: !existsSync(resolvedTaskRoot)
  };
}
