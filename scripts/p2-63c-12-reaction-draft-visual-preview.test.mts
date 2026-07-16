import assert from "node:assert/strict";
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
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  cleanupOwnPreviewArtifacts,
  createReactionPreviewRunContext,
  getIsolatedReactionPreviewBuildSteps,
  injectReactionMotionPreset,
  injectReactionPreviewAction,
  injectReactionPreviewReason,
  injectReactionPreviewTrigger,
  parseRunnerArgs,
  prepareIsolatedReactionPreview,
  REACTION_DRAFT_PROFILES,
  readReactionDraft
} from "./p2-63c-12-reaction-draft-visual-preview.mjs";

const PROFILE = "happy-small";

function makeCandidatePath(root: string, profile = PROFILE, suffix = "20260716-101010-123") {
  return join(root, `${profile}-${suffix}.motion3.json`);
}

function makeMotion(duration = 3.4, parameterId = "ParamAngleX") {
  return {
    Version: 3,
    Meta: {
      Duration: duration,
      Fps: 30,
      Loop: false,
      AreBeziersRestricted: false,
      CurveCount: 1,
      TotalSegmentCount: 1,
      TotalPointCount: 2,
      UserDataCount: 0,
      TotalUserDataSize: 0
    },
    Curves: [{
      Target: "Parameter",
      Id: parameterId,
      Segments: [0, -0.4, 0, duration, 0.8]
    }],
    UserData: []
  };
}

function writeCandidate(path: string, motion = makeMotion()) {
  writeFileSync(path, JSON.stringify(motion), "utf8");
}

function readSource(path: string) {
  return readFileSync(path, "utf8");
}

function writeTreeFile(root: string, relativePath: string, contents = relativePath) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
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
    "export const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = Object.freeze([\n]);\n"
  );
  writeTreeFile(
    root,
    "src/renderer/pet/interaction-actions.ts",
    "export const PET_INTERACTION_ACTION_TYPES = [\n];\nexport const PET_INTERACTION_ACTIONS: readonly PetInteractionAction[] = [\n];\n"
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
  writeTreeFile(root, "resources/local-llm/do-not-copy.gguf", "large-local-model");
  writeTreeFile(root, "dist/main/app.js", "stale-dist");
  writeTreeFile(root, "node_modules/.fixture", "shared-dependencies");

  const manifest = {
    id: "witch",
    sourceDir: "../../../model",
    model3: "witch.model3.json",
    moc3: "witch.moc3",
    physics: "witch.physics3.json",
    displayInfo: "witch.cdi3.json",
    idleMotion: "idle.motion3.json",
    motionPresets: [{ id: "old", path: "motions/old.motion3.json" }],
    textures: ["textures/texture.png"],
    expressions: { happy: "happy.exp3.json" }
  };
  writeTreeFile(root, "resources/models/witch/model-manifest.json", `${JSON.stringify(manifest)}\n`);
  writeTreeFile(root, "model/witch.model3.json", "{}");
  writeTreeFile(root, "model/witch.moc3", "moc");
  writeTreeFile(root, "model/witch.physics3.json", "{}");
  writeTreeFile(root, "model/witch.cdi3.json", JSON.stringify({ Parameters: [{ Id: "ParamAngleX" }] }));
  writeTreeFile(root, "model/idle.motion3.json", "{}");
  writeTreeFile(root, "model/textures/texture.png", "texture");
  writeTreeFile(root, "model/happy.exp3.json", "{}");
  writeTreeFile(root, "model/unreferenced.motion3.json", "must-not-copy");
}

function makeDirectoryLink(target: string, linkPath: string) {
  symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

test("CLI accepts exactly one supported profile and one absolute candidate", () => {
  const candidate = resolve(tmpdir(), "happy-small-20260716-101010-123.motion3.json");
  assert.deepEqual(parseRunnerArgs(["--profile", PROFILE, "--candidate-draft", candidate]), {
    profile: PROFILE,
    candidateDraft: candidate
  });
  assert.equal(REACTION_DRAFT_PROFILES.length, 3);
  assert.throws(() => parseRunnerArgs(["--candidate-draft", candidate]), /reaction-profile-not-allowed/u);
  assert.throws(() => parseRunnerArgs(["--profile", PROFILE, "--candidate-draft", "relative.motion3.json"]), /must-be-absolute/u);
  assert.throws(() => parseRunnerArgs(["--profile", "sleep-enter", "--candidate-draft", candidate]), /profile-not-allowed/u);
  assert.throws(() => parseRunnerArgs(["--profile", PROFILE, "--candidate-draft", candidate, "--profile", PROFILE]), /invalid-profile/u);
});

test("candidate reader applies Motion3 structural validation without an endpoint-closure gate", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-12-input-"));
  try {
    const candidate = makeCandidatePath(root);
    writeCandidate(candidate);
    const accepted = readReactionDraft({ profile: PROFILE, candidateDraft: candidate }, root);
    assert.deepEqual(accepted.summary, {
      safeSummaryOnly: true,
      profile: PROFILE,
      basename: "happy-small-20260716-101010-123.motion3.json",
      durationSeconds: 3.4
    });
    assert.equal(accepted.durationMs, 3_400);
    assert.deepEqual(accepted.motion.Curves[0].Segments, [0, -0.4, 0, 3.4, 0.8]);

    const invalidVersion = makeCandidatePath(root, PROFILE, "invalid-version");
    writeCandidate(invalidVersion, { ...makeMotion(), Version: 2 });
    assert.throws(
      () => readReactionDraft({ profile: PROFILE, candidateDraft: invalidVersion }, root),
      /structural-validation-failed:invalid-version/u
    );

    const unknownParameter = makeCandidatePath(root, PROFILE, "unknown-parameter");
    writeCandidate(unknownParameter, makeMotion(3.4, "ParamNotInCurrentModel"));
    assert.throws(
      () => readReactionDraft({ profile: PROFILE, candidateDraft: unknownParameter }, root),
      /unknown-parameter-id/u
    );

    const nonFinite = makeCandidatePath(root, PROFILE, "non-finite");
    writeFileSync(
      nonFinite,
      JSON.stringify(makeMotion()).replace("3.4,0.8", "3.4,1e999"),
      "utf8"
    );
    assert.throws(
      () => readReactionDraft({ profile: PROFILE, candidateDraft: nonFinite }, root),
      /invalid-segments/u
    );

    const unordered = makeCandidatePath(root, PROFILE, "unordered");
    const unorderedMotion = makeMotion();
    unorderedMotion.Meta.TotalSegmentCount = 2;
    unorderedMotion.Meta.TotalPointCount = 3;
    unorderedMotion.Curves[0].Segments = [0, -0.4, 0, 2, 0.4, 0, 1, 0.8];
    writeCandidate(unordered, unorderedMotion);
    assert.throws(
      () => readReactionDraft({ profile: PROFILE, candidateDraft: unordered }, root),
      /invalid-segment-time/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate reader permits only managed regular profile-prefixed JSON drafts", (t) => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-12-path-"));
  try {
    const candidate = makeCandidatePath(root);
    writeCandidate(candidate);

    const wrongPrefix = makeCandidatePath(root, "surprised-small");
    writeCandidate(wrongPrefix);
    assert.throws(() => readReactionDraft({ profile: PROFILE, candidateDraft: wrongPrefix }, root), /filename-profile-mismatch/u);
    assert.throws(() => readReactionDraft({ profile: PROFILE, candidateDraft: join(tmpdir(), "happy-small-other.motion3.json") }, root), /outside-managed-root/u);

    const invalidJson = join(root, "happy-small-invalid.motion3.json");
    writeFileSync(invalidJson, "{", "utf8");
    assert.throws(() => readReactionDraft({ profile: PROFILE, candidateDraft: invalidJson }, root), /invalid-json/u);

    const linked = join(root, "happy-small-linked.motion3.json");
    try {
      symlinkSync(candidate, linked, "file");
      assert.throws(() => readReactionDraft({ profile: PROFILE, candidateDraft: linked }, root), /reparse-path-rejected/u);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") t.diagnostic("symlink privilege unavailable");
      else throw error;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fixture assembles current source and declared display assets without dist or local-llm", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-12-fixture-"));
  try {
    const workspace = join(root, "workspace");
    const drafts = join(root, "drafts");
    const fixtureRoot = join(root, "isolated-app");
    mkdirSync(drafts, { recursive: true });
    makeSyntheticWorkspace(workspace);
    const candidatePath = makeCandidatePath(drafts);
    writeCandidate(candidatePath);
    const candidate = readReactionDraft({ profile: PROFILE, candidateDraft: candidatePath }, drafts, workspace);

    const fixture = prepareIsolatedReactionPreview(fixtureRoot, candidate, workspace);
    assert.equal(existsSync(join(fixtureRoot, "dist")), false);
    assert.equal(existsSync(join(fixtureRoot, "resources", "local-llm")), false);
    assert.equal(existsSync(join(fixtureRoot, "resources", "models", "witch", "model-manifest.json")), true);
    assert.equal(existsSync(join(fixtureRoot, fixture.fixtureMotionPath)), true);
    assert.equal(existsSync(join(fixtureRoot, "resources", "icons", "app-icon-256.png")), true);
    assert.equal(existsSync(join(fixtureRoot, "public", "cubism", "live2dcubismcore.min.js")), true);
    assert.equal(existsSync(join(fixtureRoot, "model-fixture", "textures", "texture.png")), true);
    assert.equal(existsSync(join(fixtureRoot, "model-fixture", "unreferenced.motion3.json")), false);
    for (const config of ["tsconfig.base.json", "tsconfig.main.json", "tsconfig.preload.json", "tsconfig.renderer.json"]) {
      assert.equal(existsSync(join(fixtureRoot, config)), true, config);
    }

    const steps = getIsolatedReactionPreviewBuildSteps(fixtureRoot);
    assert.deepEqual(steps.map(({ label, args }) => ({ label, args })), [
      { label: "main", args: ["-p", "tsconfig.main.json"] },
      { label: "preload", args: ["-p", "tsconfig.preload.json"] },
      { label: "renderer", args: ["build", "--config", "vite.config.ts"] }
    ]);
    assert.deepEqual(steps.map(({ command }) => basename(command).replace(/\.cmd$/u, "")), ["tsc", "tsc", "vite"]);
    assert.doesNotMatch(JSON.stringify(steps), /npm|verify|p2-11g/iu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fixture transforms are reaction-only and compile without production catalog edits", () => {
  const config = {
    id: "reaction-draft-preview-happy-small",
    motionPath: "motions/reaction-draft-preview-happy-small.motion3.json",
    durationSeconds: 3.4,
    durationMs: 3_400
  };
  const preset = injectReactionMotionPreset(readSource("src/shared/pet-motion-presets.ts"), config);
  const action = injectReactionPreviewAction(readSource("src/renderer/pet/interaction-actions.ts"), config);
  const trigger = injectReactionPreviewTrigger(readSource("src/renderer/pet/main.ts"), config);
  const player = injectReactionPreviewReason(readSource("src/renderer/pet/interaction-action-player.ts"));
  assert.match(preset, /semanticKind: "reaction"[\s\S]*allowedStates: \["idle"\]/u);
  assert.match(action, /type: "reaction-draft-preview-happy-small"[\s\S]*durationMs: 3400/u);
  assert.match(trigger, /REACTION_DRAFT_TRIGGER__[\s\S]*reaction_draft_visual_preview/u);
  assert.match(player, /reaction_draft_visual_preview/u);

  for (const [name, source] of Object.entries({ preset, action, trigger, player })) {
    const result = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      fileName: `${name}.ts`,
      reportDiagnostics: true
    });
    assert.deepEqual(result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error), [], name);
  }
});

test("run creation rejects a reparse .tmp directory", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-12-create-"));
  try {
    const outside = join(root, "outside");
    mkdirSync(outside);
    makeDirectoryLink(outside, join(root, ".tmp"));
    assert.throws(() => createReactionPreviewRunContext({ workspaceRoot: root }), /run-reparse-path-rejected/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup removes ordinary run contents, unlinks nested reparse entries, and preserves siblings and user drafts", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-12-cleanup-"));
  try {
    const context = createReactionPreviewRunContext({ workspaceRoot: root });
    const sibling = join(context.runParentDir, "sibling");
    const outside = join(root, "outside-target");
    const userDraft = join(root, "motion-drafts", "happy-small-user.motion3.json");
    mkdirSync(sibling);
    mkdirSync(outside);
    writeTreeFile(outside, "keep.txt", "keep");
    writeTreeFile(root, "motion-drafts/happy-small-user.motion3.json", "keep-user-draft");
    writeTreeFile(context.runDir, "ordinary/nested.txt", "remove");
    makeDirectoryLink(outside, join(context.runDir, "outside-link"));

    assert.deepEqual(cleanupOwnPreviewArtifacts(context, root), {
      runDirRemoved: true,
      runParentRemoved: false
    });
    assert.equal(existsSync(sibling), true);
    assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "keep");
    assert.equal(readFileSync(userDraft, "utf8"), "keep-user-draft");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup rejects a run directory replaced by a reparse point", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-12-replaced-run-"));
  try {
    const context = createReactionPreviewRunContext({ workspaceRoot: root });
    const outside = join(root, "outside-target");
    mkdirSync(outside);
    writeTreeFile(outside, "keep.txt", "keep");
    rmSync(context.runDir, { recursive: true });
    makeDirectoryLink(outside, context.runDir);

    assert.throws(() => cleanupOwnPreviewArtifacts(context, root), /run-directory-reparse-rejected/u);
    assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "keep");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
