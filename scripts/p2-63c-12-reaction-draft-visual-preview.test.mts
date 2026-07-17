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
  ARRIVAL_SETTLE_PARAMETER_ALLOWLIST,
  ARRIVAL_SETTLE_PROFILE,
  CITE_ACKNOWLEDGE_PARAMETER_ALLOWLIST,
  CITE_ACKNOWLEDGE_PROFILE,
  cleanupOwnPreviewArtifacts,
  createReactionPreviewRunContext,
  getIsolatedReactionPreviewBuildSteps,
  injectReactionMotionPreset,
  injectReactionPreviewAction,
  injectReactionPreviewReason,
  injectReactionPreviewTrigger,
  parseRunnerArgs,
  prepareIsolatedReactionPreview,
  GREET_SMALL_V3_PARAMETER_ALLOWLIST,
  GREET_SMALL_V3_PROFILE,
  MANAGED_VISUAL_PREVIEW_PROFILES,
  REACTION_DRAFT_PROFILES,
  readReactionDraft,
  WORK_FOCUS_PARAMETER_ALLOWLIST,
  WORK_FOCUS_PROFILE
} from "./p2-63c-12-reaction-draft-visual-preview.mjs";

const PROFILE = "happy-small";
const ARRIVAL_SETTLE_EXPECTED_PARAMETER_IDS = [
  "ParamAngleX",
  "ParamAngleY",
  "ParamAngleZ",
  "ParamEyeLOpen",
  "ParamEyeROpen"
];
const WORK_FOCUS_EXPECTED_PARAMETER_IDS = [
  "ParamAngleY",
  "ParamAngleZ",
  "ParamEyeLOpen",
  "ParamEyeROpen",
  "ParamBrowLY"
];

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

function makeGreetSmallV3Motion(duration = 3.4) {
  return {
    Version: 3,
    Meta: {
      Duration: duration,
      Fps: 30,
      Loop: false,
      AreBeziersRestricted: false,
      CurveCount: GREET_SMALL_V3_PARAMETER_ALLOWLIST.length,
      TotalSegmentCount: GREET_SMALL_V3_PARAMETER_ALLOWLIST.length,
      TotalPointCount: GREET_SMALL_V3_PARAMETER_ALLOWLIST.length * 2,
      UserDataCount: 0,
      TotalUserDataSize: 0
    },
    Curves: GREET_SMALL_V3_PARAMETER_ALLOWLIST.map((parameterId) => ({
      Target: "Parameter",
      Id: parameterId,
      Segments: [0, -0.4, 0, duration, 0.8]
    })),
    UserData: []
  };
}

function makeWorkFocusMotion(
  duration = 2.6,
  parameterIds = ["ParamAngleY"],
  variedParameterId: string | null = "ParamAngleY"
) {
  return {
    Version: 3,
    Meta: {
      Duration: duration,
      Fps: 30,
      Loop: false,
      AreBeziersRestricted: false,
      CurveCount: parameterIds.length,
      TotalSegmentCount: parameterIds.length,
      TotalPointCount: parameterIds.length * 2,
      UserDataCount: 0,
      TotalUserDataSize: 0
    },
    Curves: parameterIds.map((parameterId) => ({
      Target: "Parameter",
      Id: parameterId,
      Segments: [0, 0, 0, duration, parameterId === variedParameterId ? 0.35 : 0]
    })),
    UserData: []
  };
}

function makeCiteAcknowledgeMotion(duration = 2, varied = true) {
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
      Id: "ParamAngleY",
      Segments: [0, 0, 0, duration, varied ? 0.35 : 0]
    }],
    UserData: []
  };
}

function makeArrivalSettleMotion(
  duration = 6.4,
  variedParameterIds = ["ParamAngleX", "ParamAngleY"]
) {
  return {
    Version: 3,
    Meta: {
      Duration: duration,
      Fps: 30,
      Loop: false,
      AreBeziersRestricted: false,
      CurveCount: ARRIVAL_SETTLE_EXPECTED_PARAMETER_IDS.length,
      TotalSegmentCount: ARRIVAL_SETTLE_EXPECTED_PARAMETER_IDS.length,
      TotalPointCount: ARRIVAL_SETTLE_EXPECTED_PARAMETER_IDS.length * 2,
      UserDataCount: 0,
      TotalUserDataSize: 0
    },
    Curves: ARRIVAL_SETTLE_EXPECTED_PARAMETER_IDS.map((parameterId) => ({
      Target: "Parameter",
      Id: parameterId,
      Segments: [0, 0, 0, duration, variedParameterIds.includes(parameterId) ? 0.35 : 0]
    })),
    UserData: []
  };
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
    "import { APPROVED_MOTION_PRESETS } from \"./approved-motion-presets.ts\";\nexport const PET_MOTION_PRESETS: readonly ModelMotionPreset[] = APPROVED_MOTION_PRESETS;\n"
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

test("CLI accepts only managed visual-preview profiles and one absolute candidate", () => {
  const candidate = resolve(tmpdir(), "happy-small-20260716-101010-123.motion3.json");
  const arrivalCandidate = resolve(tmpdir(), "arrival-settle-20260716-094704-585.motion3.json");
  const greetCandidate = resolve(tmpdir(), "greet-small-v3-20260717-014841-268.motion3.json");
  const workFocusCandidate = resolve(tmpdir(), "work-focus-20260717-020432-400.motion3.json");
  const citeAcknowledgeCandidate = resolve(tmpdir(), "cite-acknowledge-20260717-022757-360.motion3.json");
  assert.deepEqual(parseRunnerArgs(["--profile", PROFILE, "--candidate-draft", candidate]), {
    profile: PROFILE,
    candidateDraft: candidate
  });
  assert.deepEqual(REACTION_DRAFT_PROFILES, ["happy-small", "surprised-small", "flustered-small"]);
  assert.deepEqual(MANAGED_VISUAL_PREVIEW_PROFILES, [
    ...REACTION_DRAFT_PROFILES,
    ARRIVAL_SETTLE_PROFILE,
    GREET_SMALL_V3_PROFILE,
    WORK_FOCUS_PROFILE,
    CITE_ACKNOWLEDGE_PROFILE
  ]);
  assert.deepEqual(parseRunnerArgs(["--profile", ARRIVAL_SETTLE_PROFILE, "--candidate-draft", arrivalCandidate]), {
    profile: ARRIVAL_SETTLE_PROFILE,
    candidateDraft: arrivalCandidate
  });
  assert.deepEqual(parseRunnerArgs(["--profile", GREET_SMALL_V3_PROFILE, "--candidate-draft", greetCandidate]), {
    profile: GREET_SMALL_V3_PROFILE,
    candidateDraft: greetCandidate
  });
  assert.deepEqual(parseRunnerArgs(["--profile", WORK_FOCUS_PROFILE, "--candidate-draft", workFocusCandidate]), {
    profile: WORK_FOCUS_PROFILE,
    candidateDraft: workFocusCandidate
  });
  assert.deepEqual(parseRunnerArgs(["--profile", CITE_ACKNOWLEDGE_PROFILE, "--candidate-draft", citeAcknowledgeCandidate]), {
    profile: CITE_ACKNOWLEDGE_PROFILE,
    candidateDraft: citeAcknowledgeCandidate
  });
  assert.throws(() => parseRunnerArgs(["--candidate-draft", candidate]), /reaction-profile-not-allowed/u);
  assert.throws(() => parseRunnerArgs(["--profile", PROFILE, "--candidate-draft", "relative.motion3.json"]), /must-be-absolute/u);
  assert.throws(() => parseRunnerArgs(["--profile", "sleep-enter", "--candidate-draft", candidate]), /profile-not-allowed/u);
  assert.throws(() => parseRunnerArgs(["--profile", PROFILE, "--candidate-draft", candidate, "--profile", PROFILE]), /invalid-profile/u);
});

test("cite-acknowledge requires its isolated Motion3 contract and safe summary", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-12-cite-acknowledge-"));
  const workspace = join(root, "workspace");
  const outsideRoot = mkdtempSync(join(tmpdir(), "p2-63c-12-cite-acknowledge-outside-"));
  try {
    makeSyntheticWorkspace(workspace);
    writeTreeFile(
      workspace,
      "model/witch.cdi3.json",
      JSON.stringify({ Parameters: CITE_ACKNOWLEDGE_PARAMETER_ALLOWLIST.map((Id) => ({ Id })) })
    );

    const candidate = makeCandidatePath(root, CITE_ACKNOWLEDGE_PROFILE);
    writeCandidate(candidate, makeCiteAcknowledgeMotion());
    const accepted = readReactionDraft({ profile: CITE_ACKNOWLEDGE_PROFILE, candidateDraft: candidate }, root, workspace);
    assert.deepEqual(accepted.summary, {
      safeSummaryOnly: true,
      profile: CITE_ACKNOWLEDGE_PROFILE,
      basename: "cite-acknowledge-20260716-101010-123.motion3.json",
      durationSeconds: 2
    });
    assert.doesNotMatch(JSON.stringify(accepted.summary), /ParamAngleY|Segments|p2-63c-12-cite-acknowledge/u);

    const wrongPrefix = makeCandidatePath(root, PROFILE, "wrong-prefix");
    writeCandidate(wrongPrefix, makeCiteAcknowledgeMotion());
    assert.throws(
      () => readReactionDraft({ profile: CITE_ACKNOWLEDGE_PROFILE, candidateDraft: wrongPrefix }, root, workspace),
      /candidate-filename-profile-mismatch/u
    );

    const outsideCandidate = makeCandidatePath(outsideRoot, CITE_ACKNOWLEDGE_PROFILE, "outside-root");
    writeCandidate(outsideCandidate, makeCiteAcknowledgeMotion());
    assert.throws(
      () => readReactionDraft({ profile: CITE_ACKNOWLEDGE_PROFILE, candidateDraft: outsideCandidate }, root, workspace),
      /candidate-outside-managed-root/u
    );

    const wrongDuration = makeCandidatePath(root, CITE_ACKNOWLEDGE_PROFILE, "wrong-duration");
    writeCandidate(wrongDuration, makeCiteAcknowledgeMotion(1.9));
    assert.throws(
      () => readReactionDraft({ profile: CITE_ACKNOWLEDGE_PROFILE, candidateDraft: wrongDuration }, root, workspace),
      /unexpected-duration/u
    );

    const wrongFps = makeCandidatePath(root, CITE_ACKNOWLEDGE_PROFILE, "wrong-fps");
    const fpsMotion = makeCiteAcknowledgeMotion();
    fpsMotion.Meta.Fps = 24;
    writeCandidate(wrongFps, fpsMotion);
    assert.throws(
      () => readReactionDraft({ profile: CITE_ACKNOWLEDGE_PROFILE, candidateDraft: wrongFps }, root, workspace),
      /unexpected-fps/u
    );

    const looping = makeCandidatePath(root, CITE_ACKNOWLEDGE_PROFILE, "looping");
    const loopingMotion = makeCiteAcknowledgeMotion();
    loopingMotion.Meta.Loop = true;
    writeCandidate(looping, loopingMotion);
    assert.throws(
      () => readReactionDraft({ profile: CITE_ACKNOWLEDGE_PROFILE, candidateDraft: looping }, root, workspace),
      /invalid-loop/u
    );

    const unexpectedParameter = makeCandidatePath(root, CITE_ACKNOWLEDGE_PROFILE, "unexpected-parameter");
    const parameterMotion = makeCiteAcknowledgeMotion();
    parameterMotion.Curves[0].Id = "ParamNotAllowlisted";
    writeCandidate(unexpectedParameter, parameterMotion);
    assert.throws(
      () => readReactionDraft({ profile: CITE_ACKNOWLEDGE_PROFILE, candidateDraft: unexpectedParameter }, root, workspace),
      /parameter-not-allowlisted/u
    );

    const flatAngleY = makeCandidatePath(root, CITE_ACKNOWLEDGE_PROFILE, "flat-angle-y");
    writeCandidate(flatAngleY, makeCiteAcknowledgeMotion(2, false));
    assert.throws(
      () => readReactionDraft({ profile: CITE_ACKNOWLEDGE_PROFILE, candidateDraft: flatAngleY }, root, workspace),
      /cite-acknowledge-variation-required/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("arrival-settle requires its exact Motion3 contract and X/Y variation", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-12-arrival-settle-"));
  const workspace = join(root, "workspace");
  try {
    assert.deepEqual(ARRIVAL_SETTLE_PARAMETER_ALLOWLIST, ARRIVAL_SETTLE_EXPECTED_PARAMETER_IDS);
    makeSyntheticWorkspace(workspace);
    writeTreeFile(
      workspace,
      "model/witch.cdi3.json",
      JSON.stringify({ Parameters: ARRIVAL_SETTLE_EXPECTED_PARAMETER_IDS.map((Id) => ({ Id })) })
    );

    const candidate = makeCandidatePath(root, ARRIVAL_SETTLE_PROFILE);
    writeCandidate(candidate, makeArrivalSettleMotion());
    const accepted = readReactionDraft({ profile: ARRIVAL_SETTLE_PROFILE, candidateDraft: candidate }, root, workspace);
    assert.deepEqual(accepted.summary, {
      safeSummaryOnly: true,
      profile: ARRIVAL_SETTLE_PROFILE,
      basename: "arrival-settle-20260716-101010-123.motion3.json",
      durationSeconds: 6.4
    });
    assert.doesNotMatch(JSON.stringify(accepted.summary), /ParamAngleX|ParamAngleY|Segments|p2-63c-12-arrival-settle/u);

    const wrongDuration = makeCandidatePath(root, ARRIVAL_SETTLE_PROFILE, "wrong-duration");
    writeCandidate(wrongDuration, makeArrivalSettleMotion(6.3));
    assert.throws(
      () => readReactionDraft({ profile: ARRIVAL_SETTLE_PROFILE, candidateDraft: wrongDuration }, root, workspace),
      /unexpected-duration/u
    );

    const wrongFps = makeCandidatePath(root, ARRIVAL_SETTLE_PROFILE, "wrong-fps");
    const fpsMotion = makeArrivalSettleMotion();
    fpsMotion.Meta.Fps = 24;
    writeCandidate(wrongFps, fpsMotion);
    assert.throws(
      () => readReactionDraft({ profile: ARRIVAL_SETTLE_PROFILE, candidateDraft: wrongFps }, root, workspace),
      /unexpected-fps/u
    );

    const looping = makeCandidatePath(root, ARRIVAL_SETTLE_PROFILE, "looping");
    const loopingMotion = makeArrivalSettleMotion();
    loopingMotion.Meta.Loop = true;
    writeCandidate(looping, loopingMotion);
    assert.throws(
      () => readReactionDraft({ profile: ARRIVAL_SETTLE_PROFILE, candidateDraft: looping }, root, workspace),
      /invalid-loop/u
    );

    const unexpectedParameter = makeCandidatePath(root, ARRIVAL_SETTLE_PROFILE, "unexpected-parameter");
    const parameterMotion = makeArrivalSettleMotion();
    parameterMotion.Curves[0].Id = "ParamNotAllowlisted";
    writeCandidate(unexpectedParameter, parameterMotion);
    assert.throws(
      () => readReactionDraft({ profile: ARRIVAL_SETTLE_PROFILE, candidateDraft: unexpectedParameter }, root, workspace),
      /parameter-not-allowlisted/u
    );

    const missingParameter = makeCandidatePath(root, ARRIVAL_SETTLE_PROFILE, "missing-parameter");
    const missingMotion = makeArrivalSettleMotion();
    missingMotion.Curves.pop();
    missingMotion.Meta.CurveCount -= 1;
    missingMotion.Meta.TotalSegmentCount -= 1;
    missingMotion.Meta.TotalPointCount -= 2;
    writeCandidate(missingParameter, missingMotion);
    assert.throws(
      () => readReactionDraft({ profile: ARRIVAL_SETTLE_PROFILE, candidateDraft: missingParameter }, root, workspace),
      /allowlist-id-not-present/u
    );

    const flatAngleX = makeCandidatePath(root, ARRIVAL_SETTLE_PROFILE, "flat-angle-x");
    writeCandidate(flatAngleX, makeArrivalSettleMotion(6.4, ["ParamAngleY"]));
    assert.throws(
      () => readReactionDraft({ profile: ARRIVAL_SETTLE_PROFILE, candidateDraft: flatAngleX }, root, workspace),
      /arrival-settle-variation-required/u
    );

    const flatAngleY = makeCandidatePath(root, ARRIVAL_SETTLE_PROFILE, "flat-angle-y");
    writeCandidate(flatAngleY, makeArrivalSettleMotion(6.4, ["ParamAngleX"]));
    assert.throws(
      () => readReactionDraft({ profile: ARRIVAL_SETTLE_PROFILE, candidateDraft: flatAngleY }, root, workspace),
      /arrival-settle-variation-required/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("work-focus requires its isolated Motion3 contract and safe summary", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-12-work-focus-"));
  const workspace = join(root, "workspace");
  try {
    assert.deepEqual(WORK_FOCUS_PARAMETER_ALLOWLIST, WORK_FOCUS_EXPECTED_PARAMETER_IDS);
    makeSyntheticWorkspace(workspace);
    writeTreeFile(
      workspace,
      "model/witch.cdi3.json",
      JSON.stringify({ Parameters: WORK_FOCUS_EXPECTED_PARAMETER_IDS.map((Id) => ({ Id })) })
    );

    const candidate = makeCandidatePath(root, WORK_FOCUS_PROFILE);
    writeCandidate(candidate, makeWorkFocusMotion());
    const accepted = readReactionDraft({ profile: WORK_FOCUS_PROFILE, candidateDraft: candidate }, root, workspace);
    assert.deepEqual(accepted.summary, {
      safeSummaryOnly: true,
      profile: WORK_FOCUS_PROFILE,
      basename: "work-focus-20260716-101010-123.motion3.json",
      durationSeconds: 2.6
    });
    assert.doesNotMatch(JSON.stringify(accepted.summary), /ParamAngleY|Segments|p2-63c-12-work-focus/u);

    const browOnlyVariation = makeCandidatePath(root, WORK_FOCUS_PROFILE, "brow-only-variation");
    writeCandidate(browOnlyVariation, makeWorkFocusMotion(2.6, ["ParamAngleY", "ParamBrowLY"], "ParamBrowLY"));
    assert.doesNotThrow(
      () => readReactionDraft({ profile: WORK_FOCUS_PROFILE, candidateDraft: browOnlyVariation }, root, workspace)
    );

    const wrongDuration = makeCandidatePath(root, WORK_FOCUS_PROFILE, "wrong-duration");
    writeCandidate(wrongDuration, makeWorkFocusMotion(2.5));
    assert.throws(
      () => readReactionDraft({ profile: WORK_FOCUS_PROFILE, candidateDraft: wrongDuration }, root, workspace),
      /unexpected-duration/u
    );

    const wrongFps = makeCandidatePath(root, WORK_FOCUS_PROFILE, "wrong-fps");
    const fpsMotion = makeWorkFocusMotion();
    fpsMotion.Meta.Fps = 24;
    writeCandidate(wrongFps, fpsMotion);
    assert.throws(
      () => readReactionDraft({ profile: WORK_FOCUS_PROFILE, candidateDraft: wrongFps }, root, workspace),
      /unexpected-fps/u
    );

    const looping = makeCandidatePath(root, WORK_FOCUS_PROFILE, "looping");
    const loopingMotion = makeWorkFocusMotion();
    loopingMotion.Meta.Loop = true;
    writeCandidate(looping, loopingMotion);
    assert.throws(
      () => readReactionDraft({ profile: WORK_FOCUS_PROFILE, candidateDraft: looping }, root, workspace),
      /invalid-loop/u
    );

    const unexpectedParameter = makeCandidatePath(root, WORK_FOCUS_PROFILE, "unexpected-parameter");
    writeCandidate(unexpectedParameter, makeWorkFocusMotion(2.6, ["ParamAngleY", "ParamNotAllowlisted"]));
    assert.throws(
      () => readReactionDraft({ profile: WORK_FOCUS_PROFILE, candidateDraft: unexpectedParameter }, root, workspace),
      /parameter-not-allowlisted/u
    );

    const flatRequiredParameters = makeCandidatePath(root, WORK_FOCUS_PROFILE, "flat-required-parameters");
    writeCandidate(flatRequiredParameters, makeWorkFocusMotion(2.6, ["ParamAngleY", "ParamBrowLY"], null));
    assert.throws(
      () => readReactionDraft({ profile: WORK_FOCUS_PROFILE, candidateDraft: flatRequiredParameters }, root, workspace),
      /work-focus-variation-required/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("greet-small-v3 requires its fixed Motion3 contract and safe summary", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-12-greet-small-v3-"));
  const workspace = join(root, "workspace");
  try {
    makeSyntheticWorkspace(workspace);
    writeTreeFile(
      workspace,
      "model/witch.cdi3.json",
      JSON.stringify({ Parameters: GREET_SMALL_V3_PARAMETER_ALLOWLIST.map((Id) => ({ Id })) })
    );

    const candidate = makeCandidatePath(root, GREET_SMALL_V3_PROFILE);
    writeCandidate(candidate, makeGreetSmallV3Motion());
    const accepted = readReactionDraft({ profile: GREET_SMALL_V3_PROFILE, candidateDraft: candidate }, root, workspace);
    assert.deepEqual(accepted.summary, {
      safeSummaryOnly: true,
      profile: GREET_SMALL_V3_PROFILE,
      basename: "greet-small-v3-20260716-101010-123.motion3.json",
      durationSeconds: 3.4
    });
    assert.doesNotMatch(JSON.stringify(accepted.summary), /ParamAngleX|Segments/u);

    const wrongPrefix = makeCandidatePath(root, PROFILE, "wrong-prefix");
    writeCandidate(wrongPrefix, makeGreetSmallV3Motion());
    assert.throws(
      () => readReactionDraft({ profile: GREET_SMALL_V3_PROFILE, candidateDraft: wrongPrefix }, root, workspace),
      /candidate-filename-profile-mismatch/u
    );

    const wrongDuration = makeCandidatePath(root, GREET_SMALL_V3_PROFILE, "wrong-duration");
    writeCandidate(wrongDuration, makeGreetSmallV3Motion(3.3));
    assert.throws(
      () => readReactionDraft({ profile: GREET_SMALL_V3_PROFILE, candidateDraft: wrongDuration }, root, workspace),
      /unexpected-duration/u
    );

    const wrongFps = makeCandidatePath(root, GREET_SMALL_V3_PROFILE, "wrong-fps");
    const fpsMotion = makeGreetSmallV3Motion();
    fpsMotion.Meta.Fps = 24;
    writeCandidate(wrongFps, fpsMotion);
    assert.throws(
      () => readReactionDraft({ profile: GREET_SMALL_V3_PROFILE, candidateDraft: wrongFps }, root, workspace),
      /unexpected-fps/u
    );

    const looping = makeCandidatePath(root, GREET_SMALL_V3_PROFILE, "looping");
    const loopingMotion = makeGreetSmallV3Motion();
    loopingMotion.Meta.Loop = true;
    writeCandidate(looping, loopingMotion);
    assert.throws(
      () => readReactionDraft({ profile: GREET_SMALL_V3_PROFILE, candidateDraft: looping }, root, workspace),
      /invalid-loop/u
    );

    const unexpectedParameter = makeCandidatePath(root, GREET_SMALL_V3_PROFILE, "unexpected-parameter");
    const parameterMotion = makeGreetSmallV3Motion();
    parameterMotion.Curves[0].Id = "ParamNotAllowlisted";
    writeCandidate(unexpectedParameter, parameterMotion);
    assert.throws(
      () => readReactionDraft({ profile: GREET_SMALL_V3_PROFILE, candidateDraft: unexpectedParameter }, root, workspace),
      /parameter-not-allowlisted/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test("arrival-settle assembles the same isolated fixture without dist or local-llm", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-63c-12-fixture-"));
  try {
    const workspace = join(root, "workspace");
    const drafts = join(root, "drafts");
    const fixtureRoot = join(root, "isolated-app");
    mkdirSync(drafts, { recursive: true });
    makeSyntheticWorkspace(workspace);
    writeTreeFile(
      workspace,
      "model/witch.cdi3.json",
      JSON.stringify({ Parameters: ARRIVAL_SETTLE_EXPECTED_PARAMETER_IDS.map((Id) => ({ Id })) })
    );
    const candidatePath = makeCandidatePath(drafts, ARRIVAL_SETTLE_PROFILE);
    writeCandidate(candidatePath, makeArrivalSettleMotion());
    const candidate = readReactionDraft({ profile: ARRIVAL_SETTLE_PROFILE, candidateDraft: candidatePath }, drafts, workspace);

    const fixture = prepareIsolatedReactionPreview(fixtureRoot, candidate, workspace);
    assert.equal(existsSync(join(fixtureRoot, "dist")), false);
    assert.equal(existsSync(join(fixtureRoot, "resources", "local-llm")), false);
    assert.equal(existsSync(join(fixtureRoot, "resources", "models", "witch", "model-manifest.json")), true);
    assert.equal(existsSync(join(fixtureRoot, fixture.fixtureMotionPath)), true);
    assert.deepEqual(readFileSync(join(fixtureRoot, fixture.fixtureMotionPath)), readFileSync(candidatePath));
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
