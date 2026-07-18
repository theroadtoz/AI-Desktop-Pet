import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  cleanupOwnManualPreviewArtifacts,
  createManualPreviewRunContext,
  getIsolatedManualPreviewBuildSteps,
  injectManualPreviewAction,
  injectManualPreviewPreset,
  injectManualPreviewReason,
  injectManualPreviewTrigger,
  P2_64J_MOTION_PROFILES,
  P2_64J_PROFILE_IDS,
  P2_64K_MOTION_PROFILES,
  P2_64K_PROFILE_IDS,
  P2_64Z_MOTION_PROFILES,
  P2_64Z_PROFILE_IDS,
  parseRunnerArgs,
  P2_64K_DRAFT_ROOT,
  prepareIsolatedManualPreview,
  readVisualOnlyCandidate,
  waitForManualPreviewTriggerAcceptance
} from "./p2-64k-manual-motion-visual-preview.mjs";

const require = createRequire(import.meta.url);
const {
  loadModelManifest
} = require("../dist/main/services/model-manifest-loader.js") as {
  loadModelManifest(modelId: string): {
    sourceRoot: string;
    managedMotionRoot: string;
    sourceRelativePaths: ReadonlySet<string>;
    managedMotionRelativePaths: ReadonlySet<string>;
  };
};
const {
  resolveModelAssetPath
} = require("../dist/main/services/model-asset-protocol.js") as {
  resolveModelAssetPath(
    manifest: {
      sourceRoot: string;
      managedMotionRoot: string;
      sourceRelativePaths: ReadonlySet<string>;
      managedMotionRelativePaths: ReadonlySet<string>;
    },
    relativePath: string
  ): Promise<string | null>;
};

function writeTreeFile(root: string, relativePath: string, contents = relativePath) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

function makeCandidatePath(root: string, profile = "listen-soft", suffix = "20260717-072342-699") {
  return join(root, `${profile}-${suffix}.motion3.json`);
}

function makeSyntheticWorkspace(root: string) {
  for (const file of [
    "package.json",
    "vite.config.ts",
    "tsconfig.base.json",
    "tsconfig.main.json",
    "tsconfig.preload.json",
    "tsconfig.renderer.json"
  ]) {
    writeTreeFile(root, file, "{}\n");
  }
  writeTreeFile(
    root,
    "src/shared/pet-motion-presets.ts",
    "import { APPROVED_MOTION_PRESETS } from \"./approved-motion-presets.ts\";\nexport const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = APPROVED_MOTION_PRESETS;\n"
  );
  writeTreeFile(
    root,
    "src/renderer/pet/interaction-actions.ts",
    "export const PET_INTERACTION_ACTION_TYPES = [\n] as const;\nexport const PET_INTERACTION_ACTIONS: readonly PetInteractionAction[] = [\n];\n"
  );
  writeTreeFile(
    root,
    "src/renderer/pet/main.ts",
    "const interactionActionPlayer = createInteractionActionPlayer({\n});\n\nfunction applyBasePresentation() {}\n"
  );
  writeTreeFile(
    root,
    "src/renderer/pet/interaction-action-player.ts",
    "export type Reason =\n  | \"startup_first_visible_frame\";\n"
  );
  writeTreeFile(root, "public/cubism/live2dcubismcore.min.js", "core");
  writeTreeFile(root, "resources/icons/app-icon-256.png", "icon");
  writeTreeFile(
    root,
    "resources/models/witch/model-manifest.json",
    `${JSON.stringify({
      id: "witch",
      sourceDir: "../../../model",
      model3: "witch.model3.json",
      moc3: "witch.moc3",
      physics: "witch.physics3.json",
      displayInfo: "witch.cdi3.json",
      idleMotion: "idle.motion3.json",
      motionPresets: [{
        id: "surprised-small",
        path: "motions/surprised-small.motion3.json"
      }],
      textures: ["textures/texture.png"],
      expressions: { happy: "happy.exp3.json" }
    }, null, 2)}\n`
  );
  writeTreeFile(root, "resources/models/witch/motions/surprised-small.motion3.json", "{}\n");
  writeTreeFile(root, "model/witch.model3.json", "{}\n");
  writeTreeFile(root, "model/witch.moc3", "model");
  writeTreeFile(root, "model/witch.physics3.json", "{}\n");
  writeTreeFile(root, "model/witch.cdi3.json", JSON.stringify({ Parameters: [{ Id: "ParamAngleX" }] }));
  writeTreeFile(root, "model/idle.motion3.json", "{}\n");
  writeTreeFile(root, "model/textures/texture.png", "texture");
  writeTreeFile(root, "model/happy.exp3.json", "{}\n");
  writeTreeFile(root, "model/unreferenced.motion3.json", "must-not-copy");
}

test("P2-64J profiles are exact and use frozen playback durations", () => {
  assert.deepEqual(P2_64J_MOTION_PROFILES, [
    { id: "listen-soft", durationSeconds: 2.4 },
    { id: "think-soft", durationSeconds: 2.8 },
    { id: "quiet-acknowledge", durationSeconds: 2.2 },
    { id: "focus-settle", durationSeconds: 2.8 },
    { id: "curious-peek", durationSeconds: 2.6 },
    { id: "look-away-soft", durationSeconds: 2.2 },
    { id: "sleepy-settle", durationSeconds: 2.8 },
    { id: "joy-bright", durationSeconds: 3 },
    { id: "surprised-big", durationSeconds: 2.6 },
    { id: "flustered-big", durationSeconds: 4.2 },
    { id: "serious-focus", durationSeconds: 2.8 },
    { id: "concern-soft", durationSeconds: 2.8 },
    { id: "playful-protest", durationSeconds: 2.4 }
  ]);
  assert.deepEqual(P2_64J_PROFILE_IDS, P2_64J_MOTION_PROFILES.map(({ id }) => id));
});

test("P2-64Z profiles have exact labels and capture-plus-padding playback durations", () => {
  assert.deepEqual(P2_64Z_MOTION_PROFILES, [
    { id: "head-pat-linger", label: "摸头后安心回应", durationSeconds: 6.4 },
    { id: "body-attention-turn", label: "身体点击后认真看向你", durationSeconds: 6.2 },
    { id: "dialogue-open-welcome", label: "打开对话时迎接", durationSeconds: 6.4 },
    { id: "reply-warm-settle", label: "回复后的温和收束", durationSeconds: 6.2 },
    { id: "music-listen-sway", label: "听见背景音乐的轻摆", durationSeconds: 8.4 },
    { id: "game-presence-glance", label: "察觉游戏运行后的陪伴注视", durationSeconds: 7.2 },
    { id: "search-note-settle", label: "找到资料后的整理回应", durationSeconds: 6.4 },
    { id: "return-from-idle", label: "久未互动后的重新见面", durationSeconds: 6.6 },
    { id: "evening-window-glance", label: "夜间安静远望", durationSeconds: 7.8 },
    { id: "long-work-recovery", label: "长时间工作后的恢复安顿", durationSeconds: 7.6 }
  ]);
  assert.deepEqual(P2_64Z_PROFILE_IDS, P2_64Z_MOTION_PROFILES.map(({ id }) => id));
  assert.deepEqual(P2_64K_MOTION_PROFILES.slice(0, P2_64J_MOTION_PROFILES.length), P2_64J_MOTION_PROFILES);
  assert.deepEqual(P2_64K_PROFILE_IDS, P2_64K_MOTION_PROFILES.map(({ id }) => id));
});

test("CLI requires one explicit allowlisted profile, its fixed duration, and an absolute candidate path", () => {
  const candidate = resolve(tmpdir(), "listen-soft-20260717-072342-699.motion3.json");
  assert.deepEqual(parseRunnerArgs(["--profile", "listen-soft", "--candidate-draft", candidate]), {
    profile: "listen-soft",
    candidateDraft: candidate
  });
  assert.throws(() => parseRunnerArgs(["--candidate-draft", candidate]), /profile-not-allowed/u);
  assert.throws(() => parseRunnerArgs(["--profile", "listen-soft", "--candidate-draft", "relative.motion3.json"]), /must-be-absolute/u);
  assert.throws(() => parseRunnerArgs(["--profile", "unknown", "--candidate-draft", candidate]), /profile-not-allowed/u);
  assert.throws(() => parseRunnerArgs(["--profile", "listen-soft", "--candidate-draft", candidate, "--profile", "listen-soft"]), /invalid-profile/u);
  assert.throws(() => parseRunnerArgs(["--profile", "head-pat-linger", "--candidate-draft", candidate, "--duration", "6.2"]), /invalid-cli-arguments/u);
  assert.match(P2_64K_DRAFT_ROOT, /motion-drafts[\\/]vts-drafts$/u);
});

test("P2-64Z profiles preserve timed accessory curves as raw bytes in their isolated fixtures", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-64z-fixture-"));
  try {
    const workspace = join(root, "workspace");
    const drafts = join(root, "drafts");
    makeSyntheticWorkspace(workspace);
    mkdirSync(drafts);

    for (const profile of P2_64Z_MOTION_PROFILES) {
      const candidatePath = makeCandidatePath(drafts, profile.id);
      const originalBytes = Buffer.from(JSON.stringify({
        Version: 3,
        Meta: { Duration: profile.durationSeconds, Fps: 30, Loop: false },
        Curves: [
          { Target: "Parameter", Id: "Param64", Segments: [0, 0, 2, 1.5, 30] },
          { Target: "Parameter", Id: "Param61", Segments: [0, 0, 2, 2.5, 30] }
        ]
      }), "utf8");
      writeFileSync(candidatePath, originalBytes);

      const candidate = readVisualOnlyCandidate({ profile: profile.id, candidateDraft: candidatePath }, drafts);
      const fixtureRoot = join(root, `fixture-${profile.id}`);
      const fixture = prepareIsolatedManualPreview(fixtureRoot, candidate, workspace);

      assert.equal(candidate.durationSeconds, profile.durationSeconds);
      assert.equal(candidate.durationMs, profile.durationSeconds * 1_000);
      assert.deepEqual(readFileSync(join(fixtureRoot, fixture.fixtureMotionPath)), originalBytes);
      assert.deepEqual(fixture.config, {
        id: `p2-64k-manual-preview-${profile.id}`,
        motionPath: `motions/p2-64k-manual-preview-${profile.id}.motion3.json`,
        durationSeconds: profile.durationSeconds,
        durationMs: profile.durationSeconds * 1_000
      });

      const wrongPrefixPath = makeCandidatePath(drafts, "listen-soft", `${profile.id}-wrong-prefix`);
      writeFileSync(wrongPrefixPath, originalBytes);
      assert.throws(
        () => readVisualOnlyCandidate({ profile: profile.id, candidateDraft: wrongPrefixPath }, drafts),
        /candidate-filename-profile-mismatch/u
      );
    }

    const source = readFileSync(new URL("./p2-64k-manual-motion-visual-preview.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /canonicalizeMotion3|validateExplicitDraftMotion/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate path rejects root escapes, wrong filenames, links, and non-files before preview", (t) => {
  const root = mkdtempSync(join(tmpdir(), "p2-64k-path-"));
  const outside = mkdtempSync(join(tmpdir(), "p2-64k-outside-"));
  try {
    const candidate = makeCandidatePath(root);
    writeFileSync(candidate, "not even structured motion data", "utf8");
    assert.equal(readVisualOnlyCandidate({ profile: "listen-soft", candidateDraft: candidate }, root).sourcePath, candidate);
    assert.throws(() => readVisualOnlyCandidate({ profile: "unknown", candidateDraft: candidate }, root), /profile-not-allowed/u);

    const wrongName = makeCandidatePath(root, "think-soft");
    writeFileSync(wrongName, "bytes", "utf8");
    assert.throws(() => readVisualOnlyCandidate({ profile: "listen-soft", candidateDraft: wrongName }, root), /filename-profile-mismatch/u);
    assert.throws(
      () => readVisualOnlyCandidate({ profile: "listen-soft", candidateDraft: makeCandidatePath(outside) }, root),
      /outside-managed-root/u
    );
    const nonRegular = join(root, "listen-soft-directory.motion3.json");
    mkdirSync(nonRegular);
    assert.throws(
      () => readVisualOnlyCandidate({ profile: "listen-soft", candidateDraft: nonRegular }, root),
      /candidate-not-regular-file/u
    );
    assert.throws(
      () => readVisualOnlyCandidate({ profile: "listen-soft", candidateDraft: root }, root),
      /filename-profile-mismatch/u
    );

    const linked = makeCandidatePath(root, "listen-soft", "linked");
    try {
      symlinkSync(candidate, linked, "file");
      assert.throws(() => readVisualOnlyCandidate({ profile: "listen-soft", candidateDraft: linked }, root), /reparse-path-rejected/u);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") t.diagnostic("symlink privilege unavailable");
      else throw error;
    }

    const linkedParent = join(root, "linked-parent");
    const linkedTarget = join(outside, "linked-target");
    mkdirSync(linkedTarget);
    const linkedChild = makeCandidatePath(linkedTarget, "listen-soft", "through-linked-parent");
    writeFileSync(linkedChild, "bytes", "utf8");
    try {
      symlinkSync(linkedTarget, linkedParent, process.platform === "win32" ? "junction" : "dir");
      assert.throws(
        () => readVisualOnlyCandidate({ profile: "listen-soft", candidateDraft: join(linkedParent, "listen-soft-through-linked-parent.motion3.json") }, root),
        /reparse-path-rejected/u
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") t.diagnostic("directory link privilege unavailable");
      else throw error;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("candidate reading is raw-byte only and makes no technical verdict", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-64k-raw-bytes-"));
  try {
    const candidatePath = makeCandidatePath(root, "flustered-big");
    const originalBytes = Buffer.from([0, 255, 123, 10, 77, 101, 116, 97, 58, 0]);
    writeFileSync(candidatePath, originalBytes);
    const candidate = readVisualOnlyCandidate({ profile: "flustered-big", candidateDraft: candidatePath }, root);
    assert.deepEqual(candidate.bytes, originalBytes);
    assert.equal(candidate.durationSeconds, 4.2);
    assert.deepEqual(candidate.summary, {
      visualOnly: true,
      profile: "flustered-big",
      basename: "flustered-big-20260717-072342-699.motion3.json",
      playbackDurationSeconds: 4.2
    });

    const source = readFileSync(new URL("./p2-64k-manual-motion-visual-preview.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /createHash|validateExplicitDraftMotion|canonicalizeMotion3/u);
    assert.doesNotMatch(source, /JSON\.parse\(\s*(bytes|readFileSync\(candidatePath|candidateBytes)/u);
    assert.doesNotMatch(source, /candidate\.motion|candidate\.sha|Meta\.Duration|Curves/u);
    assert.doesNotMatch(JSON.stringify(candidate.summary), /validated|accepted|passed|allowlist|variation/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isolated fixture copies bytes and only patches its own app", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-64k-fixture-"));
  try {
    const workspace = join(root, "workspace");
    const drafts = join(root, "drafts");
    const fixtureRoot = join(root, "fixture");
    makeSyntheticWorkspace(workspace);
    mkdirSync(drafts);
    const candidatePath = makeCandidatePath(drafts, "listen-soft");
    const originalBytes = Buffer.from("unparsed source bytes\n", "utf8");
    writeFileSync(candidatePath, originalBytes);
    const sourcePreset = readFileSync(join(workspace, "src/shared/pet-motion-presets.ts"), "utf8");
    const sourceAction = readFileSync(join(workspace, "src/renderer/pet/interaction-actions.ts"), "utf8");
    const candidate = readVisualOnlyCandidate({ profile: "listen-soft", candidateDraft: candidatePath }, drafts);

    const fixture = prepareIsolatedManualPreview(fixtureRoot, candidate, workspace);
    assert.deepEqual(readFileSync(candidatePath), originalBytes);
    assert.deepEqual(readFileSync(join(fixtureRoot, fixture.fixtureMotionPath)), originalBytes);
    assert.equal(readFileSync(join(workspace, "src/shared/pet-motion-presets.ts"), "utf8"), sourcePreset);
    assert.equal(readFileSync(join(workspace, "src/renderer/pet/interaction-actions.ts"), "utf8"), sourceAction);
    assert.equal(existsSync(join(fixtureRoot, "dist")), false);
    assert.equal(existsSync(join(fixtureRoot, "resources", "local-llm")), false);

    const config = fixture.config;
    const transformed = {
      preset: injectManualPreviewPreset(sourcePreset, config),
      action: injectManualPreviewAction(sourceAction, config),
      trigger: injectManualPreviewTrigger(readFileSync(join(workspace, "src/renderer/pet/main.ts"), "utf8"), config),
      reason: injectManualPreviewReason(readFileSync(join(workspace, "src/renderer/pet/interaction-action-player.ts"), "utf8"))
    };
    for (const [name, source] of Object.entries(transformed)) {
      const result = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        fileName: `${name}.ts`,
        reportDiagnostics: true
      });
      assert.deepEqual(result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error), [], name);
    }
    assert.match(transformed.preset, /\.\.\.APPROVED_MOTION_PRESETS/u);
    assert.deepEqual(getIsolatedManualPreviewBuildSteps().map(({ label, args }) => ({ label, args })), [
      { label: "main", args: ["-p", "tsconfig.main.json"] },
      { label: "preload", args: ["-p", "tsconfig.preload.json"] },
      { label: "renderer", args: ["build", "--config", "vite.config.ts"] }
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isolated fixture registers preview motion while preserving approved managed assets and safe source resolution", { concurrency: false }, async () => {
  const root = mkdtempSync(join(tmpdir(), "p2-64k-manifest-"));
  const previousCwd = process.cwd();
  try {
    const workspace = join(root, "workspace");
    const drafts = join(root, "drafts");
    const fixtureRoot = join(root, "fixture");
    makeSyntheticWorkspace(workspace);
    mkdirSync(drafts);
    const candidatePath = makeCandidatePath(drafts, "listen-soft");
    writeFileSync(candidatePath, Buffer.from("visual-only-bytes\n", "utf8"));
    const candidate = readVisualOnlyCandidate({ profile: "listen-soft", candidateDraft: candidatePath }, drafts);
    const fixture = prepareIsolatedManualPreview(fixtureRoot, candidate, workspace);

    assert.equal(existsSync(join(fixtureRoot, "model-fixture", "witch.model3.json")), true);
    assert.equal(existsSync(join(fixtureRoot, "model-fixture", "unreferenced.motion3.json")), false);

    process.chdir(fixtureRoot);
    const manifest = loadModelManifest("witch");
    assert.equal(manifest.sourceRoot, join(fixtureRoot, "model-fixture"));
    assert.equal(manifest.managedMotionRoot, join(fixtureRoot, "resources", "models", "witch"));
    assert.equal(manifest.managedMotionRelativePaths.has(fixture.config.motionPath), true);
    assert.equal(manifest.managedMotionRelativePaths.has("motions/surprised-small.motion3.json"), true);

    assert.equal(
      await resolveModelAssetPath(manifest, fixture.config.motionPath),
      join(fixtureRoot, "resources", "models", "witch", fixture.config.motionPath)
    );
    assert.equal(
      await resolveModelAssetPath(manifest, "motions/surprised-small.motion3.json"),
      join(fixtureRoot, "resources", "models", "witch", "motions", "surprised-small.motion3.json")
    );
    assert.equal(
      await resolveModelAssetPath(manifest, "witch.model3.json"),
      join(fixtureRoot, "model-fixture", "witch.model3.json")
    );
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("preview trigger retries until startup action clears instead of relying on a fixed sleep", async () => {
  const calls: boolean[] = [];
  let attempt = 0;
  await waitForManualPreviewTriggerAcceptance({
    timeoutMs: 100,
    intervalMs: 5,
    now: () => attempt * 5,
    sleepFn: async () => {
      attempt += 1;
    },
    trigger: async () => {
      calls.push(true);
      return calls.length >= 3;
    }
  });
  assert.equal(calls.length, 3);
  let timeoutTick = 0;
  await assert.rejects(() => waitForManualPreviewTriggerAcceptance({
    timeoutMs: 10,
    intervalMs: 5,
    now: () => timeoutTick,
    sleepFn: async () => {
      timeoutTick += 5;
    },
    trigger: async () => false
  }), /preview-trigger-rejected/u);
});

test("cleanup removes only its run directory and preserves sibling/user files", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-64k-cleanup-"));
  try {
    const context = createManualPreviewRunContext({ workspaceRoot: root });
    const sibling = join(context.runParentDir, "sibling");
    const userDraft = join(root, "motion-drafts", "listen-soft-user.motion3.json");
    const outside = join(root, "outside-target");
    mkdirSync(sibling);
    mkdirSync(outside);
    writeTreeFile(context.runDir, "isolated-app/temporary.log", "remove");
    writeTreeFile(root, "motion-drafts/listen-soft-user.motion3.json", "keep");
    writeTreeFile(outside, "keep.txt", "keep-outside");
    try {
      symlinkSync(outside, join(context.runDir, "outside-link"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }

    assert.deepEqual(cleanupOwnManualPreviewArtifacts(context, root), {
      runDirRemoved: true,
      runParentRemoved: false
    });
    assert.equal(existsSync(sibling), true);
    assert.equal(readFileSync(userDraft, "utf8"), "keep");
    assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "keep-outside");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run context initializes pages for the real-ui wait and stop lifecycle", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-64k-pages-"));
  try {
    const context = createManualPreviewRunContext({ workspaceRoot: root });
    assert.deepEqual(context.pages, []);
    cleanupOwnManualPreviewArtifacts(context, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
