import { createHash, randomInt, randomUUID } from "node:crypto";
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { getRepoRoot } from "./p2-20j-stage-electron-builder-extra-resources.mjs";
import { findNsisInstaller, findUninstaller } from "./p2-20m-nsis-installer-lifecycle.mjs";
import { CdpClient, evaluate, waitFor } from "./support/real-ui-harness.mjs";

const runName = "p2-87f-packaged-bundled-memory-acceptance";
const installTimeoutMs = 240_000;
const uninstallTimeoutMs = 180_000;
const chatTimeoutMs = 180_000;
const syntheticSentinel = "P2_87F_MEMORY_SENTINEL";
const sensitiveChatSentinel = "sk-p287f-sensitive";
const p2_87FLocalLlmTarget = Object.freeze({
  runtime: "llama.cpp",
  platform: "win32-x64",
  executable: "runtime/win32-x64/llama-server.exe",
  executableSizeBytes: 9216,
  executableSha256: "28713f013309fc1ad213232b429547e046d8928d6352ef006f47cb4e6515b388",
  modelPath: "models/model.gguf",
  modelAlias: "qwen3.5-2b-q4_k_m",
  modelSizeBytes: 1396198496,
  modelSha256: "57a1085840f497d764a7fc5d346922dbde961efb54cc792ea81d694fd846a1d8",
  licenseNotices: "licenses/THIRD_PARTY_NOTICES.md"
});
const forbiddenRuntimeOverrides = [
  "AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT",
  "AI_DESKTOP_PET_PROVIDER",
  "AI_DESKTOP_PET_API_KEY",
  "AI_DESKTOP_PET_BASE_URL",
  "AI_DESKTOP_PET_MODEL"
];
const safeReasonCodes = new Set([
  "dependency_not_prepared",
  "runtime_override_forbidden",
  "clean_worktree_required",
  "stage_validation_failed",
  "stage_copy_failed",
  "stage_config_write_failed",
  "package_build_failed",
  "package_builder_failed",
  "package_output_missing",
  "installer_missing",
  "install_failed",
  "resource_audit_failed",
  "launch_failed",
  "ui_failed",
  "restart_failed",
  "uninstall_failed",
  "user_data_removed_by_uninstaller",
  "cleanup_failed",
  "windows_only",
  "script_failed"
]);
const allowedWorktreeChanges = [
  "scripts/p2-87f-packaged-bundled-memory-acceptance.mjs",
  "scripts/p2-87f-packaged-bundled-memory-acceptance.test.mts"
];

export function getP2_87FCleanWorktreeDependencyContract() {
  return {
    allowedWorktreeChanges: [...allowedWorktreeChanges],
    requiredExistingPaths: [
      "node_modules",
      "node_modules/electron/dist/electron.exe",
      "node_modules/typescript/bin/tsc",
      "node_modules/vite/bin/vite.js",
      "node_modules/electron-builder/out/cli/cli.js"
    ]
  };
}

export function assertP2_87FNoRuntimeOverrides(env = process.env) {
  if (forbiddenRuntimeOverrides.some((key) => typeof env[key] === "string" && env[key].trim().length > 0)) {
    throw new Error("p2_87f_runtime_override_forbidden");
  }
}

export function createP2_87FInstalledAppEnv(userDataRoot, env = process.env) {
  const minimal = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP", "LOCALAPPDATA", "USERPROFILE"]) {
    if (typeof env[key] === "string" && env[key].length > 0) minimal[key] = env[key];
  }
  return {
    ...minimal,
    AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
    AI_DESKTOP_PET_ALLOW_PACKAGED_USER_DATA_OVERRIDE: "1",
    AI_DESKTOP_PET_USER_DATA_PATH: userDataRoot
  };
}

export function createP2_87FCDPPorts() {
  const first = randomInt(20_000, 60_000);
  return [first, first + 1];
}

export function getP2_87FLeakSentinels() {
  return [syntheticSentinel, sensitiveChatSentinel];
}

export function assertP2_87FCleanWorktreeStatus(statusLines) {
  if (!Array.isArray(statusLines) || statusLines.some((line) => {
    const path = typeof line === "string" ? line.slice(3).trim() : "";
    return !allowedWorktreeChanges.includes(path);
  })) {
    throw new Error("p2_87f_clean_worktree_required");
  }
}

export function getP2_87FPaths(repoRoot = getRepoRoot()) {
  const runRoot = join(resolve(repoRoot), ".tmp", runName);
  const installParentRoot = join(runRoot, "installed-app");
  return {
    runRoot,
    stagingRoot: join(runRoot, "extra-resources"),
    stagedLocalLlmRoot: join(runRoot, "extra-resources", "local-llm"),
    packageOutputRoot: join(runRoot, "package-output"),
    packageConfigPath: join(runRoot, "electron-builder.config.cjs"),
    installParentRoot,
    installRoot: join(installParentRoot, "app"),
    userDataRoot: join(runRoot, "user-data")
  };
}

export function assertSafeP2_87FTmpRoot(candidateRoot, repoRoot = getRepoRoot()) {
  const tmpRoot = resolve(repoRoot, ".tmp");
  const candidate = resolve(candidateRoot);
  const prefix = tmpRoot.endsWith(sep) ? tmpRoot : `${tmpRoot}${sep}`;
  if (!candidate.startsWith(prefix)) throw new Error("p2_87f_destination_outside_repo_tmp");
}

export function toSafeSummary(value) {
  return {
    ok: value?.ok === true,
    status: value?.status === "ready" ? "ready" : value?.status === "blocked" ? "blocked" : "script_failed",
    ...(safeReasonCodes.has(value?.reasonCode) ? { reasonCode: value.reasonCode } : {}),
    safeSummaryOnly: true
  };
}

async function main() {
  const repoRoot = getRepoRoot();
  const paths = getP2_87FPaths(repoRoot);
  let result = { ok: false, status: "script_failed" };
  let cleanupOk = false;

  try {
    result = await runAcceptance(repoRoot, paths);
  } catch (error) {
    result = {
      ok: false,
      status: "script_failed",
      reasonCode: toSafeReasonCode(error)
    };
  } finally {
    cleanupOk = cleanup(paths, repoRoot);
  }

  if (!cleanupOk) result = { ok: false, status: "blocked", reasonCode: "cleanup_failed" };

  const summary = toSafeSummary(result);
  console.log(JSON.stringify(summary));
  if (!summary.ok) process.exitCode = 1;
}

async function runAcceptance(repoRoot, paths) {
  if (process.platform !== "win32") return { ok: false, status: "blocked", reasonCode: "windows_only" };
  assertP2_87FNoRuntimeOverrides();
  assertP2_87FCleanWorktreeDependencies(repoRoot);
  for (const root of [paths.runRoot, paths.stagingRoot, paths.packageOutputRoot, paths.installParentRoot, paths.installRoot, paths.userDataRoot]) {
    assertSafeP2_87FTmpRoot(root, repoRoot);
  }
  rmSync(paths.runRoot, { recursive: true, force: true });
  mkdirSync(paths.installParentRoot, { recursive: true });
  seedIsolatedUserData(paths.userDataRoot);

  const staged = stageLocalLlmForP2_87F(repoRoot, paths);
  if (!staged.ok) return { ok: false, status: "blocked", reasonCode: staged.reasonCode };

  const packaged = packageP2_87F(repoRoot, paths);
  if (!packaged.ok) return { ok: false, status: "blocked", reasonCode: packaged.reasonCode };

  const installerPath = findNsisInstaller(paths.packageOutputRoot);
  if (!installerPath) return { ok: false, status: "blocked", reasonCode: "installer_missing" };
  const installed = runProcess(installerPath, ["/S", `/D=${paths.installRoot}`], paths.packageOutputRoot, installTimeoutMs);
  if (installed.status !== 0) return { ok: false, status: "blocked", reasonCode: "install_failed" };

  const layout = await inspectInstalledResources(paths.installRoot);
  if (!layout.ok) return { ok: false, status: "blocked", reasonCode: "resource_audit_failed" };

  const [firstPort, secondPort] = createP2_87FCDPPorts();
  const firstRun = await runInstalledUiAcceptance(layout, paths.userDataRoot, firstPort);
  if (!firstRun.ok) return { ok: false, status: "blocked", reasonCode: firstRun.reasonCode ?? "ui_failed" };

  const restarted = await verifyForgetAfterRestart(layout.appExecutablePath, paths.userDataRoot, secondPort);
  if (!restarted.ok) return { ok: false, status: "blocked", reasonCode: "restart_failed" };

  const uninstalled = uninstall(layout.uninstallerPath, paths.installRoot);
  if (uninstalled && !existsSync(paths.userDataRoot)) return { ok: false, status: "blocked", reasonCode: "user_data_removed_by_uninstaller" };
  return {
    ok: uninstalled,
    status: uninstalled ? "ready" : "blocked",
    ...(uninstalled ? {} : { reasonCode: "uninstall_failed" })
  };
}

function toSafeReasonCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (message === "p2_87f_dependencies_not_prepared") return "dependency_not_prepared";
  if (message === "p2_87f_runtime_override_forbidden") return "runtime_override_forbidden";
  if (message === "p2_87f_clean_worktree_required") return "clean_worktree_required";
  return "script_failed";
}

function assertP2_87FCleanWorktreeDependencies(repoRoot) {
  const contract = getP2_87FCleanWorktreeDependencyContract();
  if (!inspectP2_87FPreparedDependencies(repoRoot).prepared) {
    throw new Error("p2_87f_dependencies_not_prepared");
  }
  const status = spawnSync("git.exe", ["status", "--porcelain=v1"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true
  });
  if (status.status !== 0) throw new Error("p2_87f_git_status_unavailable");
  assertP2_87FCleanWorktreeStatus(status.stdout.split(/\r?\n/).filter(Boolean));
}

export function inspectP2_87FPreparedDependencies(repoRoot, exists = existsSync) {
  const prepared = getP2_87FCleanWorktreeDependencyContract()
    .requiredExistingPaths
    .every((relativePath) => exists(join(repoRoot, relativePath)));
  return { prepared };
}

export function getP2_87FStagingSourceRoot(env = process.env) {
  const configured = typeof env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT === "string"
    ? env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT.trim()
    : "";
  return configured || null;
}

export function getP2_87FLocalLlmTargetContract() {
  return { ...p2_87FLocalLlmTarget };
}

export function validateP2_87FStagingSource(sourceRoot, target = p2_87FLocalLlmTarget) {
  if (!sourceRoot || !existsSync(sourceRoot)) return { ok: false };

  const root = resolve(sourceRoot);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8").replace(/^\uFEFF/u, ""));
  } catch {
    return { ok: false };
  }

  const runtime = manifest?.platforms?.[target.platform];
  const model = manifest?.model;
  if (manifest?.version !== 1 || manifest?.runtime !== target.runtime
    || runtime?.executable !== target.executable || runtime?.sizeBytes !== target.executableSizeBytes || runtime?.sha256 !== target.executableSha256
    || model?.path !== target.modelPath || model?.alias !== target.modelAlias || model?.sizeBytes !== target.modelSizeBytes || model?.sha256 !== target.modelSha256
    || manifest?.licenseNotices !== target.licenseNotices) {
    return { ok: false };
  }
  const entries = [
    { path: target.executable, sizeBytes: target.executableSizeBytes, sha256: target.executableSha256 },
    { path: target.modelPath, sizeBytes: target.modelSizeBytes, sha256: target.modelSha256 }
  ];

  for (const entry of entries) {
    if (typeof entry.path !== "string" || isAbsolute(entry.path) || !Number.isInteger(entry.sizeBytes)
      || entry.sizeBytes < 0 || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/iu.test(entry.sha256)) {
      return { ok: false };
    }
    const filePath = resolve(root, entry.path);
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    if (!filePath.startsWith(prefix)) return { ok: false };
    try {
      if (!statSync(filePath).isFile() || statSync(filePath).size !== entry.sizeBytes
        || createHash("sha256").update(readFileSync(filePath)).digest("hex") !== entry.sha256.toLowerCase()) {
        return { ok: false };
      }
    } catch {
      return { ok: false };
    }
  }
  const noticesPath = resolve(root, target.licenseNotices);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  try {
    if (!noticesPath.startsWith(prefix) || !statSync(noticesPath).isFile() || statSync(noticesPath).size === 0) return { ok: false };
  } catch {
    return { ok: false };
  }
  return { ok: true };
}

export function stageLocalLlmForP2_87F(repoRoot, paths, env = process.env, target = p2_87FLocalLlmTarget) {
  const sourceRoot = getP2_87FStagingSourceRoot(env);
  if (!validateP2_87FStagingSource(sourceRoot, target).ok) return { ok: false, reasonCode: "stage_validation_failed" };
  try {
    mkdirSync(paths.stagingRoot, { recursive: true });
    cpSync(sourceRoot, paths.stagedLocalLlmRoot, {
      recursive: true,
      force: true,
      errorOnExist: false
    });
  } catch {
    return { ok: false, reasonCode: "stage_copy_failed" };
  }
  try {
    writeFileSync(paths.packageConfigPath, [
      `const base = require(${JSON.stringify(join(repoRoot, "electron-builder.config.cjs"))});`,
      "module.exports = {",
      "  ...base,",
      `  directories: { ...base.directories, output: ${JSON.stringify(paths.packageOutputRoot)} },`,
      "  extraResources: base.extraResources.map((entry, index) => index === 0",
      `    ? { ...entry, from: ${JSON.stringify(paths.stagedLocalLlmRoot)} }`,
      "    : entry)",
      "};"
    ].join("\n"), "utf8");
  } catch {
    return { ok: false, reasonCode: "stage_config_write_failed" };
  }
  return { ok: true };
}

export function createP2_87FBuilderArgs(packageConfigPath) {
  return ["exec", "electron-builder", "--", "--win", "nsis", "--config", packageConfigPath, "--publish", "never"];
}

function packageP2_87F(repoRoot, paths) {
  const build = runNpm(repoRoot, "build", 12 * 60_000);
  if (build.status !== 0) return { ok: false, reasonCode: "package_build_failed" };
  const builder = runProcess("npm.cmd", createP2_87FBuilderArgs(paths.packageConfigPath), repoRoot, 12 * 60_000);
  if (builder.status !== 0) return { ok: false, reasonCode: "package_builder_failed" };
  return existsSync(paths.packageOutputRoot)
    ? { ok: true }
    : { ok: false, reasonCode: "package_output_missing" };
}

function seedIsolatedUserData(userDataRoot) {
  rmSync(userDataRoot, { recursive: true, force: true });
  const now = Date.now();
  const confirmedCandidateId = randomUUID();
  const blockedCandidateId = randomUUID();
  const conversations = Array.from({ length: 101 }, (_, index) => {
    const id = randomUUID();
    const messageId = randomUUID();
    const createdAt = now - (101 - index) * 1_000;
    return {
      id,
      title: `acceptance-${index + 1}`,
      createdAt,
      updatedAt: createdAt,
      messages: [{ id: messageId, role: "user", content: `acceptance-${index + 1}`, createdAt }],
      summary: { conversationId: id, sourceMessageIds: [messageId], content: `summary-${index + 1}`, updatedAt: createdAt }
    };
  });
  const baseConversationId = conversations[0].id;
  const baseMessageId = conversations[0].messages[0].id;
  const candidate = {
    id: confirmedCandidateId,
    action: "create",
    title: "偏好",
    content: syntheticSentinel,
    tags: ["语言"],
    namespace: "personal",
    key: "language-preference",
    importance: "key",
    category: "language",
    confidence: 0.91,
    sourceConversationId: baseConversationId,
    sourceMessageId: baseMessageId,
    status: "pending-review",
    createdAt: now,
    updatedAt: now
  };
  const blockedCandidate = { ...candidate, id: blockedCandidateId, key: "sensitive", category: "sensitive", status: "blocked" };
  writeJson(join(userDataRoot, "history", "conversations.json"), {
    version: 2,
    retentionLimit: 500,
    conversations: conversations.map(({ summary, ...conversation }) => conversation),
    semanticSummaries: conversations.map((conversation) => conversation.summary)
  });
  writeJson(join(userDataRoot, "memory", "facts.json"), { version: 4, enabled: true, cards: [], suppressions: [] });
  writeJson(join(userDataRoot, "memory", "reviews.json"), { version: 1, candidates: [candidate, blockedCandidate] });
  writeJson(join(userDataRoot, "p2-87f-sentinel.json"), { confirmedCandidateId, blockedCandidateId });
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function inspectInstalledResources(installRoot) {
  const appExecutablePath = join(installRoot, "AI Desktop Pet.exe");
  const uninstallerPath = findUninstaller(installRoot);
  const localLlmRoot = join(installRoot, "resources", "local-llm");
  const manifestPath = join(localLlmRoot, "manifest.json");
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { manifest = null; }
  const target = p2_87FLocalLlmTarget;
  const runtime = manifest?.platforms?.[target.platform];
  const model = manifest?.model;
  const resourceChecks = [
    existsSync(appExecutablePath),
    Boolean(uninstallerPath),
    manifest?.version === 1,
    manifest?.runtime === target.runtime,
    runtime?.executable === target.executable && runtime?.sizeBytes === target.executableSizeBytes && runtime?.sha256 === target.executableSha256,
    model?.path === target.modelPath && model?.alias === target.modelAlias && model?.sizeBytes === target.modelSizeBytes && model?.sha256 === target.modelSha256,
    manifest?.licenseNotices === target.licenseNotices && isNonEmptyPlainFile(join(localLlmRoot, target.licenseNotices)),
    await hashMatches(join(localLlmRoot, target.executable), target.executableSha256, target.executableSizeBytes),
    await hashMatches(join(localLlmRoot, target.modelPath), target.modelSha256, target.modelSizeBytes)
  ];
  return {
    ok: resourceChecks.every(Boolean),
    appExecutablePath,
    uninstallerPath,
    localLlmRoot,
    modelPath: model?.path === target.modelPath ? join(localLlmRoot, target.modelPath) : null
  };
}

function isNonEmptyPlainFile(path) {
  try { return statSync(path).isFile() && statSync(path).size > 0; } catch { return false; }
}

async function hashMatches(path, expectedHash, expectedSize) {
  if (!Number.isSafeInteger(expectedSize)) return false;
  try {
    if (statSync(path).size !== expectedSize) return false;
    const hash = createHash("sha256");
    await new Promise((resolveHash, rejectHash) => {
      createReadStream(path)
        .on("data", (chunk) => hash.update(chunk))
        .once("end", resolveHash)
        .once("error", rejectHash);
    });
    return hash.digest("hex") === expectedHash;
  } catch { return false; }
}

async function runInstalledUiAcceptance(layout, userDataRoot, port) {
  const child = launchInstalledApp(layout.appExecutablePath, userDataRoot, port);
  let page;
  let spawnedLlamaEvidence = { ok: false };
  try {
    page = await waitForChatPage(port);
    const sentinel = JSON.parse(readFileSync(join(userDataRoot, "p2-87f-sentinel.json"), "utf8"));
    const prepared = await evaluate(page, `(async () => {
      const history = window.historyApi;
      const memory = window.memoryApi;
      if (!history || !memory) return { ready: false };
      const defaultLimit = await history.getRetentionLimit();
      const before = await history.listConversations();
      const reviews = await memory.listReviews();
      const pending = reviews.find((item) => item.id === ${JSON.stringify(sentinel.confirmedCandidateId)});
      const blocked = reviews.find((item) => item.id === ${JSON.stringify(sentinel.blockedCandidateId)});
      const confirmed = pending ? await memory.confirmReview(pending.id) : { status: "not_found" };
      const cardsAfterConfirm = await memory.listCards();
      const automaticCard = cardsAfterConfirm.find((card) => card.sourceType === "auto-local-model");
      const forgotten = automaticCard ? await memory.forgetCard(automaticCard.id) : { status: "not_found" };
      const afterForget = await memory.listCards();
      const manualCreated = await memory.createCard({ title: "手动保留测试", content: "手动事实卡应独立于自动忘记保留。", tags: ["验收"], sourceConversationId: before[0]?.id || crypto.randomUUID() });
      const manualForget = manualCreated.status === "created" ? await memory.forgetCard(manualCreated.card.id) : { status: "not_found" };
      const cardsAfterManualForget = await memory.listCards();
      await history.setRetentionLimit(100);
      const retained = await history.listConversations();
      await memory.setEnabled(false);
      const disabledCreate = await memory.createCard({ title: "关闭测试", content: "不会创建。", tags: ["验收"], sourceConversationId: before[0]?.id || crypto.randomUUID() });
      await memory.setEnabled(true);
      await memory.clearCards();
      const [afterClearMemory, suppressions] = await Promise.all([memory.listCards(), memory.listSuppressions()]);
      await history.clearConversations();
      const afterClearHistory = await history.listConversations();
      const retainedLimit = await history.getRetentionLimit();
      const blockedDecision = blocked ? await memory.confirmReview(blocked.id) : { status: "not_found" };
      return {
        ready: true,
        defaultLimit: defaultLimit === 500,
        initialHistory: before.length === 101,
        pendingReview: pending?.status === "pending-review",
        blockedReview: blocked?.status === "blocked",
        confirmed: confirmed.status === "confirmed",
        confirmedCard: cardsAfterConfirm.length === 1,
        retention: retained.length === 100,
        memoryOff: disabledCreate.status === "disabled",
        forgotten: forgotten.status === "forgotten" && afterForget.length === 0,
        manualIndependent: manualForget.status === "manual" && cardsAfterManualForget.length === 1,
        clearHistory: afterClearHistory.length === 0 && retainedLimit === 100,
        clearMemory: afterClearMemory.length === 0 && suppressions.length === 1,
        blockedDecision: blockedDecision.status === "not_found",
        controls: Boolean(document.querySelector("#history-retention-limit") && document.querySelector("#memory-reviews")),
        noSummaryText: !document.body.textContent.includes("summary-")
      };
    })()`);
    const sensitiveBundledChat = await sendSensitiveBundledMessage(page);
    spawnedLlamaEvidence = inspectSpawnedBundledLlama(child.pid, layout.localLlmRoot, layout.modelPath);
    const postChat = await evaluate(page, `(async () => {
      const history = window.historyApi;
      const memory = window.memoryApi;
      if (!history || !memory) return { ready: false };
      const [reviews, conversations, cards, suppressions] = await Promise.all([
        memory.listReviews(), history.listConversations(), memory.listCards(), memory.listSuppressions()
      ]);
      await history.clearConversations();
      const afterClear = await history.listConversations();
      return {
        ready: true,
        sensitiveAutoBlocked: reviews.length === 2 && reviews.some((candidate) => candidate.status === "blocked"),
        freshConversation: conversations.length === 1,
        clearAfterSensitiveChat: afterClear.length === 0,
        cardsCleared: cards.length === 0,
        suppressionPreserved: suppressions.length === 1
      };
    })()`);
    const diskChecks = inspectPostUiStorage(userDataRoot);
    const noLeaks = hasNoSentinelLeak(userDataRoot);
    return {
      ok: Object.values(prepared ?? {}).every(Boolean) && sensitiveBundledChat && spawnedLlamaEvidence.ok &&
        Object.values(postChat ?? {}).every(Boolean) && diskChecks && noLeaks
    };
  } catch (error) {
    return { ok: false, reasonCode: error instanceof Error && error.message === "chat_page_unavailable" ? "launch_failed" : "ui_failed" };
  } finally {
    if (page?.cdp) page.cdp.close();
    if (!stopProcessTree(child.pid, spawnedLlamaEvidence.ok ? [spawnedLlamaEvidence.llamaPid] : [])) return { ok: false };
  }
}

async function sendSensitiveBundledMessage(page) {
  await evaluate(page, `(() => {
    const input = document.querySelector("#chat-input");
    const form = document.querySelector("#chat-form");
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return false;
    input.value = ${JSON.stringify(`请不要保存这段敏感内容：${sensitiveChatSentinel}`)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    form.requestSubmit();
    return true;
  })()`);
  return await waitFor(page, `
    document.querySelector("#send-button")?.textContent === "发送" &&
    [...document.querySelectorAll(".message-pet .message-content")].some((node) => node.textContent.trim().length > 0)
  `, { timeoutMs: chatTimeoutMs, intervalMs: 500 }).then(() => true).catch(() => false);
}

function inspectPostUiStorage(userDataRoot) {
  try {
    const history = JSON.parse(readFileSync(join(userDataRoot, "history", "conversations.json"), "utf8"));
    const facts = JSON.parse(readFileSync(join(userDataRoot, "memory", "facts.json"), "utf8"));
    const reviews = JSON.parse(readFileSync(join(userDataRoot, "memory", "reviews.json"), "utf8"));
    return history.conversations.length === 0 && history.semanticSummaries.length === 0 && facts.cards.length === 0 &&
      facts.suppressions.length === 1 && reviews.candidates.some((candidate) => candidate.status === "confirmed");
  } catch { return false; }
}

function hasNoSentinelLeak(userDataRoot) {
  const logsRoot = join(userDataRoot, "logs");
  const pending = [logsRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !existsSync(current)) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (/\.(?:log|jsonl)$/i.test(entry.name)) {
        const text = readFileSync(entryPath, "utf8");
        if (getP2_87FLeakSentinels().some((sentinel) => text.includes(sentinel))) return false;
      }
    }
  }
  return true;
}

async function verifyForgetAfterRestart(appExecutablePath, userDataRoot, port) {
  const child = launchInstalledApp(appExecutablePath, userDataRoot, port);
  let page;
  let stopped = false;
  try {
    page = await waitForChatPage(port);
    const checks = await evaluate(page, `(async () => {
      const memory = window.memoryApi;
      if (!memory) return false;
      const [cards, suppressions] = await Promise.all([memory.listCards(), memory.listSuppressions()]);
      return cards.length === 0 && suppressions.length === 1;
    })()`);
    return { ok: checks === true };
  } catch { return { ok: false }; }
  finally {
    if (page?.cdp) page.cdp.close();
    stopped = stopProcessTree(child.pid);
    if (!stopped) throw new Error("p2_87f_process_cleanup_incomplete");
  }
}

function launchInstalledApp(appExecutablePath, userDataRoot, port) {
  assertP2_87FNoRuntimeOverrides();
  return spawn(appExecutablePath, [`--remote-debugging-port=${port}`], {
    cwd: dirname(appExecutablePath),
    env: createP2_87FInstalledAppEnv(userDataRoot),
    stdio: "ignore",
    windowsHide: true
  });
}

function inspectSpawnedBundledLlama(appPid, localLlmRoot, modelPath) {
  if (!appPid || !localLlmRoot || !modelPath) return { ok: false };
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-Command",
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"
  ], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) return { ok: false };
  let processes;
  try {
    const parsed = JSON.parse(result.stdout);
    processes = Array.isArray(parsed) ? parsed : [parsed];
  } catch { return { ok: false }; }
  const byPid = new Map(processes.filter((item) => item && typeof item.ProcessId === "number").map((item) => [item.ProcessId, item]));
  const llama = processes.find((item) =>
    typeof item?.Name === "string" && item.Name.toLowerCase() === "llama-server.exe" &&
    typeof item?.CommandLine === "string" && item.CommandLine.includes(localLlmRoot) && item.CommandLine.includes(modelPath)
  );
  if (!llama) return { ok: false };
  let parentPid = llama.ParentProcessId;
  const seen = new Set();
  while (typeof parentPid === "number" && !seen.has(parentPid)) {
    if (parentPid === appPid) return { ok: true, llamaPid: llama.ProcessId };
    seen.add(parentPid);
    parentPid = byPid.get(parentPid)?.ParentProcessId;
  }
  return { ok: false };
}

async function waitForChatPage(port) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.ok ? response.json() : []);
      const target = targets.find((entry) => entry.type === "page" && entry.url.includes("renderer/chat/index.html"));
      if (target) {
        const cdp = new CdpClient(target.webSocketDebuggerUrl);
        await cdp.open();
        await cdp.send("Runtime.enable");
        await waitFor({ cdp }, "Boolean(window.historyApi && window.memoryApi && document.querySelector('#history-retention-limit'))", 30_000);
        return { cdp };
      }
    } catch {}
    await delay(300);
  }
  throw new Error("chat_page_unavailable");
}

function uninstall(uninstallerPath, installRoot) {
  if (!uninstallerPath) return false;
  const result = runProcess(uninstallerPath, ["/currentuser", "/S"], installRoot, uninstallTimeoutMs);
  return result.status === 0 && waitForRemoval(installRoot, 30_000);
}

function waitForRemoval(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(path)) return true;
    sleepSync(300);
  }
  return !existsSync(path);
}

function runNpm(repoRoot, name, timeoutMs) {
  return runProcess("npm.cmd", ["run", name], repoRoot, timeoutMs);
}

export function normalizeP2_87FProcessInvocation(command, args, env = process.env, platform = process.platform) {
  if (platform === "win32" && /\.cmd$/iu.test(command)) {
    const comSpec = typeof env.ComSpec === "string" && env.ComSpec.length > 0
      ? env.ComSpec
      : "cmd.exe";
    return { command: comSpec, args: ["/d", "/s", "/c", command, ...args] };
  }
  return { command, args };
}

function runProcess(command, args, cwd, timeoutMs) {
  const invocation = normalizeP2_87FProcessInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, { cwd, env: process.env, encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status };
}

function stopProcessTree(pid, childPids = []) {
  if (!pid) return false;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  return [pid, ...childPids].every((candidatePid) => waitForProcessRemoval(candidatePid, 15_000));
}

function waitForProcessRemoval(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = spawnSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0 && !result.stdout.includes(`\"${pid}\"`)) return true;
    sleepSync(250);
  }
  return false;
}

function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }

function sleepSync(ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

function cleanup(paths, repoRoot) {
  try {
    assertSafeP2_87FTmpRoot(paths.runRoot, repoRoot);
    rmSync(paths.runRoot, { recursive: true, force: true });
    return !existsSync(paths.runRoot);
  } catch {
    return false;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
