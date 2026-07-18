import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  cleanupOwnComponentProbeArtifacts,
  assertRegularTree,
  checkWindowsReparsePath,
  checkWindowsReparseTree,
  createComponentProbeRunContext,
  getIsolatedComponentProbeBuildSteps,
  injectComponentProbeAction,
  injectComponentProbeExpressionAppliedSignal,
  injectComponentProbeMotionPreset,
  injectComponentProbeReason,
  injectComponentProbeTrigger,
  P2_64V_ANGRY_DURATION_MS,
  P2_64V_EXPRESSION_APPLIED_SIGNAL,
  P2_64V_NEUTRAL_DURATION_MS,
  P2_64V_TEAR_DURATION_MS,
  P2_64V_TEAR_MOTION_ID,
  P2_64V_TEAR_MOTION_PATH,
  P2_64V_TEAR_PARAMETER_IDS,
  P2_64V_TEAR_STIMULUS,
  prepareIsolatedComponentProbe,
  readProbeManifest,
  waitForComponentProbeTriggerAcceptance
} from "./p2-64v-model-native-component-probe.mjs";

const ROOT = join(import.meta.dirname, "..");

test("P2-64V tear stimulus is restricted to the confirmed non-flat parameter trio", () => {
  assert.deepEqual(P2_64V_TEAR_PARAMETER_IDS, ["Param25", "Param26", "Param27"]);
  assert.equal(P2_64V_TEAR_STIMULUS.Meta.Duration, 2.4);
  assert.equal(P2_64V_TEAR_STIMULUS.Meta.CurveCount, 3);
  assert.equal(P2_64V_TEAR_STIMULUS.Meta.Loop, false);
  assert.deepEqual(P2_64V_TEAR_STIMULUS.Curves.map((curve) => curve.Id), P2_64V_TEAR_PARAMETER_IDS);
  for (const curve of P2_64V_TEAR_STIMULUS.Curves) {
    assert.equal(curve.Target, "Parameter");
    assert.equal(curve.Segments[1], 0);
    assert.equal(curve.Segments[4], 30);
    assert.equal(curve.Segments.at(-1), 0);
  }
});

test("P2-64V requires the real manifest angry resource", () => {
  assert.deepEqual(readProbeManifest(ROOT), {
    manifest: JSON.parse(readFileSync(join(ROOT, "resources", "models", "witch", "model-manifest.json"), "utf8")),
    manifestPath: join(ROOT, "resources", "models", "witch", "model-manifest.json"),
    angryExpressionName: "angry",
    angryExpressionPath: "sq.exp3.json"
  });
});

test("P2-64V fixture is isolated, contains only its authored tear motion, and uses manifest angry", () => {
  const root = mkdtempSync(join(tmpdir(), "p2-64v-fixture-"));
  const fixtureRoot = join(root, "fixture");
  const sourceFiles = [
    "resources/models/witch/model-manifest.json",
    "src/shared/pet-motion-presets.ts",
    "src/renderer/pet/interaction-actions.ts",
    "src/renderer/pet/interaction-action-player.ts",
    "src/renderer/pet/main.ts"
  ];
  const original = new Map(sourceFiles.map((path) => [path, readFileSync(join(ROOT, path), "utf8")]));
  try {
    const fixture = prepareIsolatedComponentProbe(fixtureRoot, ROOT);
    assert.equal(fixture.angryExpressionName, "angry");
    assert.equal(fixture.angryExpressionPath, "sq.exp3.json");
    assert.deepEqual(fixture.stageOrder, ["tear-parameters", "neutral-after-tear", "angry-expression", "neutral-after-angry"]);
    assert.equal(existsSync(join(fixtureRoot, fixture.fixtureMotionPath)), true);
    assert.deepEqual(
      JSON.parse(readFileSync(join(fixtureRoot, fixture.fixtureMotionPath), "utf8")),
      P2_64V_TEAR_STIMULUS
    );
    assert.equal(existsSync(join(fixtureRoot, "model-fixture", "sq.exp3.json")), true);
    assert.equal(existsSync(join(fixtureRoot, "model-fixture", "zs1.exp3.json")), true);
    assert.equal(existsSync(join(fixtureRoot, "dist")), false);
    assert.equal(existsSync(join(fixtureRoot, "resources", "local-llm")), false);
    for (const [path, contents] of original) {
      assert.equal(readFileSync(join(ROOT, path), "utf8"), contents, path);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P2-64V test-only injections preserve production source and apply the exact staged paths", () => {
  const sources = {
    preset: readFileSync(join(ROOT, "src/shared/pet-motion-presets.ts"), "utf8"),
    action: readFileSync(join(ROOT, "src/renderer/pet/interaction-actions.ts"), "utf8"),
    reason: readFileSync(join(ROOT, "src/renderer/pet/interaction-action-player.ts"), "utf8"),
    expression: readFileSync(join(ROOT, "src/renderer/pet/live2d/cubism-expression.ts"), "utf8"),
    trigger: readFileSync(join(ROOT, "src/renderer/pet/main.ts"), "utf8")
  };
  const transformed = {
    preset: injectComponentProbeMotionPreset(sources.preset),
    action: injectComponentProbeAction(sources.action),
    reason: injectComponentProbeReason(sources.reason),
    expression: injectComponentProbeExpressionAppliedSignal(sources.expression),
    trigger: injectComponentProbeTrigger(sources.trigger, "angry")
  };
  for (const [name, source] of Object.entries(transformed)) {
    const result = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      fileName: `${name}.ts`,
      reportDiagnostics: true
    });
    assert.deepEqual(result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error), [], name);
  }
  assert.match(transformed.preset, new RegExp(P2_64V_TEAR_MOTION_PATH.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(transformed.trigger, /const expressionLoad = live2DModel\?\.setExpression\("angry"\)/u);
  assert.match(transformed.trigger, /Promise\.resolve\(expressionLoad\)\.then\(\(\) => \{/u);
  assert.match(transformed.trigger, new RegExp(`globalThis\\.${P2_64V_EXPRESSION_APPLIED_SIGNAL} !== "angry"`, "u"));
  assert.match(transformed.expression, new RegExp(`${P2_64V_EXPRESSION_APPLIED_SIGNAL} = null`, "u"));
  assert.match(transformed.expression, new RegExp(`${P2_64V_EXPRESSION_APPLIED_SIGNAL} = expressionName`, "u"));
  assert.ok(
    transformed.trigger.indexOf(`globalThis.${P2_64V_EXPRESSION_APPLIED_SIGNAL} !== "angry"`)
      < transformed.trigger.indexOf('setP264VComponentProbeStage("angry-expression",'),
    "the visible angry stage must remain behind the fixture-only applied signal"
  );
  assert.ok(
    transformed.expression.indexOf(`this.manager.startMotion(motion, false);`)
      < transformed.expression.indexOf(`${P2_64V_EXPRESSION_APPLIED_SIGNAL} = expressionName`),
    "the fixture-only applied signal must be emitted only after manager.startMotion"
  );
  const expressionSignalResetIndex = transformed.expression.indexOf(`${P2_64V_EXPRESSION_APPLIED_SIGNAL} = null;`);
  assert.ok(
    expressionSignalResetIndex
      < transformed.expression.indexOf("if (!expressionPath)", expressionSignalResetIndex),
    "missing expression resources must leave the fixture-only applied signal unset"
  );
  assert.match(transformed.trigger, /scheduleP264VComponentProbe\(scheduleNeutralAfterAngry, 2600\)/u);
  assert.match(transformed.trigger, /\.catch\(\(\) => \{/u);
  assert.match(transformed.trigger, /生气表达式加载失败，未进入展示/u);
  const injectedTrigger = transformed.trigger.slice(
    transformed.trigger.indexOf("type P2_64VComponentProbeGlobal"),
    transformed.trigger.indexOf("function applyBasePresentation(")
  );
  assert.doesNotMatch(injectedTrigger, /void live2DModel\?\.setExpression/u);
  assert.match(transformed.trigger, /sq\.exp3\.json/u);
  assert.match(transformed.trigger, /Param25 \/ Param26 \/ Param27/u);
  assert.equal(P2_64V_TEAR_DURATION_MS + P2_64V_NEUTRAL_DURATION_MS + P2_64V_ANGRY_DURATION_MS, 6_000);
  for (const [path, contents] of Object.entries(sources)) {
    const sourcePath = {
      preset: "src/shared/pet-motion-presets.ts",
      action: "src/renderer/pet/interaction-actions.ts",
      reason: "src/renderer/pet/interaction-action-player.ts",
      expression: "src/renderer/pet/live2d/cubism-expression.ts",
      trigger: "src/renderer/pet/main.ts"
    }[path];
    assert.equal(readFileSync(join(ROOT, sourcePath), "utf8"), contents, path);
  }
});

test("P2-64V Windows reparse protection rejects injected reparse results without creating a junction", () => {
  const calls: Array<{ command: string; args: string[]; options: { env: Record<string, string> } }> = [];
  assert.throws(() => checkWindowsReparsePath(
    "C:\\safe\\workspace\\.tmp",
    "probe-tmp-reparse-rejected",
    "probe-tmp-check-failed",
    {
      platform: "win32",
      spawnSyncFn: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 23 };
      }
    }
  ), /probe-tmp-reparse-rejected/u);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "powershell.exe");
  assert.equal(calls[0]?.options.env.P2_64V_PATH, "C:\\safe\\workspace\\.tmp");
  assert.match(calls[0]?.args.join("\n") ?? "", /ReparsePoint/u);
  assert.doesNotThrow(() => checkWindowsReparsePath(
    "C:\\safe\\workspace\\.tmp",
    "probe-tmp-reparse-rejected",
    "probe-tmp-check-failed",
    { platform: "win32", spawnSyncFn: () => ({ status: 0 }) }
  ));
  assert.throws(() => checkWindowsReparsePath(
    "C:\\safe\\workspace\\.tmp",
    "probe-tmp-reparse-rejected",
    "probe-tmp-check-failed",
    { platform: "win32", spawnSyncFn: () => ({ status: 1 }) }
  ), /probe-tmp-check-failed/u);
});

test("P2-64V rejects nested symbolic links and injected Windows reparse trees before copy", () => {
  const directories = new Set(["root", join("root", "nested")]);
  assert.throws(() => assertRegularTree(
    "root",
    "source-tree-reparse-rejected",
    "source-tree-invalid",
    {
      lstatSyncFn: (path) => ({
        isSymbolicLink: () => path === join("root", "nested", "link"),
        isFile: () => path === join("root", "nested", "link"),
        isDirectory: () => directories.has(path)
      }),
      readdirSyncFn: (path) => path === "root" ? ["nested"] : ["link"],
      checkWindowsReparseTreeFn: () => undefined
    }
  ), /source-tree-reparse-rejected/u);

  const calls: Array<{ command: string; args: string[]; options: { env: Record<string, string> } }> = [];
  assert.throws(() => checkWindowsReparseTree(
    "C:\\safe\\workspace\\src",
    "source-tree-reparse-rejected",
    "source-tree-check-failed",
    {
      platform: "win32",
      spawnSyncFn: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 23 };
      }
    }
  ), /source-tree-reparse-rejected/u);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.options.env.P2_64V_PATH, "C:\\safe\\workspace\\src");
  assert.match(calls[0]?.args.join("\n") ?? "", /Get-ChildItem -LiteralPath/u);
});

test("P2-64V runner never references a user draft directory or substitutes angry parameters", () => {
  const source = readFileSync(new URL("./p2-64v-model-native-component-probe.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /motion-drafts|vts-drafts|candidate-draft|readVisualOnlyCandidate/u);
  assert.doesNotMatch(source, /Param61|Param62|Param67|ParamBrowLForm|ParamBrowLY/u);
  assert.match(source, /sq\.exp3\.json/u);
  assert.match(source, /checkWindowsReparsePath\(/u);
  assert.match(source, /P2_64V_PATH/u);
});

test("P2-64V trigger retries and cleanup removes only its own run", async () => {
  let attempts = 0;
  await waitForComponentProbeTriggerAcceptance({
    timeoutMs: 100,
    intervalMs: 5,
    now: () => attempts * 5,
    sleepFn: async () => { attempts += 1; },
    trigger: async () => attempts >= 2
  });
  assert.equal(attempts, 2);

  const root = mkdtempSync(join(tmpdir(), "p2-64v-cleanup-"));
  try {
    const context = createComponentProbeRunContext({ workspaceRoot: root });
    const sibling = join(context.runParentDir, "sibling");
    const preserved = join(root, "preserved.txt");
    mkdirSync(sibling);
    writeFileSync(preserved, "keep", "utf8");
    writeFileSync(join(context.runDir, "temporary.log"), "remove", "utf8");
    assert.deepEqual(cleanupOwnComponentProbeArtifacts(context, root), {
      runDirRemoved: true,
      runParentRemoved: false
    });
    assert.equal(existsSync(sibling), true);
    assert.equal(readFileSync(preserved, "utf8"), "keep");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P2-64V isolated build plan is local and complete", () => {
  assert.deepEqual(getIsolatedComponentProbeBuildSteps().map(({ label, args }) => ({ label, args })), [
    { label: "main", args: ["-p", "tsconfig.main.json"] },
    { label: "preload", args: ["-p", "tsconfig.preload.json"] },
    { label: "renderer", args: ["build", "--config", "vite.config.ts"] }
  ]);
});
