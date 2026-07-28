import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const runner = await import("./p2-87f-packaged-bundled-memory-acceptance.mjs");

test("P2-87F keeps every mutable artifact in its dedicated repo .tmp root", () => {
  const repoRoot = process.cwd();
  const paths = runner.getP2_87FPaths(repoRoot);
  const tmpRoot = resolve(repoRoot, ".tmp");

  for (const candidate of [paths.runRoot, paths.stagingRoot, paths.packageOutputRoot, paths.installParentRoot, paths.installRoot, paths.userDataRoot]) {
    assert.ok(resolve(candidate).startsWith(`${tmpRoot}\\`));
    assert.doesNotThrow(() => runner.assertSafeP2_87FTmpRoot(candidate, repoRoot));
  }
  assert.throws(() => runner.assertSafeP2_87FTmpRoot(repoRoot, repoRoot), /p2_87f_destination_outside_repo_tmp/);
});

test("P2-87F runner is a real packaged acceptance and never configures a fallback provider", async () => {
  const source = await readFile(join(process.cwd(), "scripts", "p2-87f-packaged-bundled-memory-acceptance.mjs"), "utf8");

  assert.match(source, /createP2_87FBuilderArgs/);
  assert.match(source, /AI_DESKTOP_PET_ALLOW_PACKAGED_USER_DATA_OVERRIDE/);
  assert.match(source, /--remote-debugging-port=/);
  assert.match(source, /manifest\.json/);
  assert.match(source, /confirmReview/);
  assert.match(source, /clearConversations/);
  assert.doesNotMatch(source, /AI_DESKTOP_PET_PROVIDER\s*:\s*["']fake["']/);
  assert.doesNotMatch(source, /ollama|lm studio|lmstudio/i);
});

test("P2-87F only prints a closed safe summary", () => {
  const summary = runner.toSafeSummary({
    ok: true,
    status: "ready",
    internalPath: "C:\\secret\\path",
    prompt: "do not print",
    nested: { key: "do not print", count: 1 }
  });

  assert.deepEqual(summary, { ok: true, status: "ready", safeSummaryOnly: true });
});

test("P2-87F drives the installed chat input through its actual HTMLInputElement contract", async () => {
  const [source, html] = await Promise.all([
    readFile(join(process.cwd(), "scripts", "p2-87f-packaged-bundled-memory-acceptance.mjs"), "utf8"),
    readFile(join(process.cwd(), "src", "renderer", "chat", "index.html"), "utf8")
  ]);

  assert.match(html, /<input id="chat-input"/);
  assert.match(source, /input instanceof HTMLInputElement/);
  assert.doesNotMatch(source, /input instanceof HTMLTextAreaElement/);
  assert.doesNotMatch(source, /localRuntimeApi/);
});

test("P2-87F requires a prepared clean worktree without installing or mutating dependencies", () => {
  const contract = runner.getP2_87FCleanWorktreeDependencyContract();

  assert.deepEqual(contract.allowedWorktreeChanges, [
    "scripts/p2-87f-packaged-bundled-memory-acceptance.mjs",
    "scripts/p2-87f-packaged-bundled-memory-acceptance.test.mts"
  ]);
  assert.deepEqual(contract.requiredExistingPaths, [
    "node_modules",
    "node_modules/electron/dist/electron.exe",
    "node_modules/typescript/bin/tsc",
    "node_modules/vite/bin/vite.js",
    "node_modules/electron-builder/out/cli/cli.js"
  ]);
  assert.doesNotThrow(() => runner.assertP2_87FCleanWorktreeStatus([
    "?? scripts/p2-87f-packaged-bundled-memory-acceptance.mjs",
    "?? scripts/p2-87f-packaged-bundled-memory-acceptance.test.mts"
  ]));
  assert.throws(() => runner.assertP2_87FCleanWorktreeStatus([
    " M src/main/app.ts"
  ]), /p2_87f_clean_worktree_required/);
});

test("P2-87F uses a controlled staging-only local-model source and never propagates it to the installed app", () => {
  assert.throws(() => runner.assertP2_87FNoRuntimeOverrides({ AI_DESKTOP_PET_PROVIDER: "external" }), /p2_87f_runtime_override_forbidden/);
  assert.throws(() => runner.assertP2_87FNoRuntimeOverrides({ AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: "override" }), /p2_87f_runtime_override_forbidden/);

  const env = runner.createP2_87FInstalledAppEnv("isolated-user-data", {
    PATH: "safe-path",
    AI_DESKTOP_PET_PROVIDER: "external",
    AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: "staging-only-source"
  });
  assert.equal(env.AI_DESKTOP_PET_USER_DATA_PATH, "isolated-user-data");
  assert.equal(env.AI_DESKTOP_PET_PROVIDER, undefined);
  assert.equal(env.AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT, undefined);
  assert.equal(env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT, undefined);
  assert.equal(runner.getP2_87FStagingSourceRoot({}), null);
  assert.equal(runner.getP2_87FStagingSourceRoot({ AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: "staging-only-source" }), "staging-only-source");
});

test("P2-87F requires a valid fixed manifest/hash staging source", () => {
  assert.deepEqual(runner.validateP2_87FStagingSource(null), { ok: false });
  assert.deepEqual(runner.getP2_87FLocalLlmTargetContract().runtime, "llama.cpp");
  assert.deepEqual(runner.getP2_87FLocalLlmTargetContract().modelAlias, "qwen3.5-2b-q4_k_m");

  const root = mkdtempSync(join(tmpdir(), "p2-87f-local-llm-"));
  const stageRoot = mkdtempSync(join(tmpdir(), "p2-87f-stage-"));
  const stagePaths = {
    stagingRoot: join(stageRoot, "extra-resources"),
    stagedLocalLlmRoot: join(stageRoot, "extra-resources", "local-llm"),
    packageConfigPath: join(stageRoot, "electron-builder.config.cjs"),
    packageOutputRoot: join(stageRoot, "package-output")
  };
  const executable = "runtime/win32-x64/llama-server.exe";
  const model = "models/model.gguf";
  const notices = "licenses/THIRD_PARTY_NOTICES.md";
  const executableContent = "runtime fixture";
  const modelContent = "model fixture";
  const integrity = (content: string) => ({
    sizeBytes: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex")
  });

  try {
    mkdirSync(join(root, "runtime", "win32-x64"), { recursive: true });
    mkdirSync(join(root, "models"), { recursive: true });
    mkdirSync(join(root, "licenses"), { recursive: true });
    writeFileSync(join(root, executable), executableContent, "utf8");
    writeFileSync(join(root, model), modelContent, "utf8");
    writeFileSync(join(root, notices), "fixture notices", "utf8");
    const target = {
      ...runner.getP2_87FLocalLlmTargetContract(),
      platform: process.platform === "win32" ? "win32-x64" : `${process.platform}-${process.arch}`,
      executable,
      executableSizeBytes: Buffer.byteLength(executableContent),
      executableSha256: integrity(executableContent).sha256,
      modelPath: model,
      modelAlias: "qwen3.5-2b-q4_k_m",
      modelSizeBytes: Buffer.byteLength(modelContent),
      modelSha256: integrity(modelContent).sha256,
      licenseNotices: notices
    };
    writeFileSync(join(root, "manifest.json"), JSON.stringify({
      version: 1,
      runtime: target.runtime,
      platforms: { [target.platform]: { executable, ...integrity(executableContent) } },
      model: { path: model, alias: target.modelAlias, ...integrity(modelContent) },
      licenseNotices: notices
    }), "utf8");

    assert.deepEqual(runner.stageLocalLlmForP2_87F("repo", stagePaths, {
      AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: ""
    }), {
      ok: false,
      reasonCode: "stage_validation_failed"
    });
    assert.deepEqual(runner.validateP2_87FStagingSource(root, target), { ok: true });
    assert.deepEqual(runner.stageLocalLlmForP2_87F("repo", stagePaths, {
      AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: root
    }, target), { ok: true });
    const wrongModel = "models/wrong.gguf";
    const wrongModelContent = "self-consistent but wrong model";
    writeFileSync(join(root, wrongModel), wrongModelContent, "utf8");
    writeFileSync(join(root, "manifest.json"), JSON.stringify({
      version: 1,
      runtime: target.runtime,
      platforms: { [target.platform]: { executable, ...integrity(executableContent) } },
      model: { path: wrongModel, alias: "other-model", ...integrity(wrongModelContent) },
      licenseNotices: notices
    }), "utf8");
    assert.deepEqual(runner.validateP2_87FStagingSource(root, target), { ok: false });
    assert.deepEqual(runner.stageLocalLlmForP2_87F("repo", stagePaths, {
      AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: root
    }, target), {
      ok: false,
      reasonCode: "stage_validation_failed"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(stageRoot, { recursive: true, force: true });
  }
});

test("P2-87F uses per-run CDP ports and scans both memory and sensitive-chat sentinels", () => {
  const first = runner.createP2_87FCDPPorts();
  const second = runner.createP2_87FCDPPorts();
  const sentinels = runner.getP2_87FLeakSentinels();

  assert.equal(first.length, 2);
  assert.equal(new Set(first).size, 2);
  assert.notDeepEqual(first, second);
  assert.ok(sentinels.length >= 2);
});

test("P2-87F cleanup is run-scoped and fails closed when uninstall removes isolated user data", async () => {
  const source = await readFile(join(process.cwd(), "scripts", "p2-87f-packaged-bundled-memory-acceptance.mjs"), "utf8");

  assert.match(source, /user_data_removed_by_uninstaller/);
  assert.match(source, /cleanup_failed/);
  assert.doesNotMatch(source, /p2jPaths\.stagingRoot|p2jPaths\.packageOutputRoot/);
  assert.match(source, /spawnedLlamaEvidence/);
});

test("P2-87F invokes the project-local electron-builder through explicit npm argv instead of ambient PATH", () => {
  const args = runner.createP2_87FBuilderArgs("isolated-builder-config");

  assert.deepEqual(args, ["exec", "electron-builder", "--", "--win", "nsis", "--config", "isolated-builder-config", "--publish", "never"]);
});

test("P2-87F normalizes Windows cmd shims without joining their argv", () => {
  const windowsCmd = runner.normalizeP2_87FProcessInvocation("npm.cmd", ["exec", "electron-builder", "--", "--win"], {
    ComSpec: "C:\\Windows\\System32\\cmd.exe"
  }, "win32");
  assert.deepEqual(windowsCmd, {
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", "npm.cmd", "exec", "electron-builder", "--", "--win"]
  });

  assert.deepEqual(runner.normalizeP2_87FProcessInvocation("npm.cmd", ["run", "build"], {}, "linux"), {
    command: "npm.cmd",
    args: ["run", "build"]
  });
  assert.deepEqual(runner.normalizeP2_87FProcessInvocation("git.exe", ["status"], {}, "win32"), {
    command: "git.exe",
    args: ["status"]
  });
});

test("P2-87F creates its own staging parent before copying the controlled local-model source", async () => {
  const source = await readFile(join(process.cwd(), "scripts", "p2-87f-packaged-bundled-memory-acceptance.mjs"), "utf8");
  const mkdirIndex = source.indexOf("mkdirSync(paths.stagingRoot, { recursive: true });");
  const copyIndex = source.indexOf("cpSync(sourceRoot, paths.stagedLocalLlmRoot");

  assert.ok(mkdirIndex >= 0);
  assert.ok(copyIndex > mkdirIndex);
});

test("P2-87F dependency inspection fails closed for every required build CLI entry", () => {
  const contract = runner.getP2_87FCleanWorktreeDependencyContract();
  assert.ok(contract.requiredExistingPaths.includes("node_modules/typescript/bin/tsc"));
  assert.ok(contract.requiredExistingPaths.includes("node_modules/vite/bin/vite.js"));
  assert.ok(contract.requiredExistingPaths.includes("node_modules/electron-builder/out/cli/cli.js"));

  for (const missing of contract.requiredExistingPaths) {
    const status = runner.inspectP2_87FPreparedDependencies("repo", (path) => path !== join("repo", missing));
    assert.deepEqual(status, { prepared: false }, `missing ${missing} must fail closed`);
  }
});

test("P2-87F exposes a known staging failure as a closed reason code without sensitive data", () => {
  for (const reasonCode of ["stage_validation_failed", "stage_copy_failed", "stage_config_write_failed"]) {
    const summary = runner.toSafeSummary({
      ok: false,
      status: "blocked",
      reasonCode,
      internalError: "sk-p287f-private"
    });

    assert.deepEqual(summary, { ok: false, status: "blocked", reasonCode, safeSummaryOnly: true });
    assert.doesNotMatch(JSON.stringify(summary), /sk-p287f-private/);
  }
});

test("P2-87F exposes known package failures as closed reason codes without sensitive data", async () => {
  const source = await readFile(join(process.cwd(), "scripts", "p2-87f-packaged-bundled-memory-acceptance.mjs"), "utf8");
  assert.match(source, /reasonCode: "package_build_failed"/);
  assert.match(source, /reasonCode: "package_builder_failed"/);
  assert.match(source, /reasonCode: "package_output_missing"/);

  for (const reasonCode of ["package_build_failed", "package_builder_failed", "package_output_missing"]) {
    const summary = runner.toSafeSummary({
      ok: false,
      status: "blocked",
      reasonCode,
      internalError: "C:\\private\\package-output"
    });

    assert.deepEqual(summary, { ok: false, status: "blocked", reasonCode, safeSummaryOnly: true });
    assert.doesNotMatch(JSON.stringify(summary), /private\\package-output/);
  }
});
