import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("P2-88C real-UI runner proves shadow-only behavior with safe evidence and cleanup", () => {
  const source = readFileSync(
    new URL("./p2-88c-curious-shadow-real-ui.mjs", import.meta.url),
    "utf8"
  );

  assert.match(source, /AI_DESKTOP_PET_PROVIDER:\s*"fake"/);
  assert.match(source, /AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY:\s*"1"/);
  assert.match(source, /xita_interaction_cue_shadow_observed/);
  assert.match(source, /positiveShadowCount === 1/);
  assert.match(source, /negativeShadowCount === 0/);
  assert.match(source, /settingsDisabledShadowCount === 0/);
  assert.match(source, /dialogueAffectApi\.setSettings\(\{ enabled: false \}\)/);
  assert.match(source, /curiousStateTelemetryObserved === false/);
  assert.match(source, /curiousContextTelemetryObserved === false/);
  assert.match(source, /curiousActionTelemetryObserved === false/);
  assert.match(source, /dynamic safe shadow observation and no-observation/);
  assert.match(source, /static zero-wiring contract/);
  assert.match(source, /auxiliary telemetry field observations are not standalone semantic proof/);
  assert.match(source, /shadowPayloadExactKeys/);
  assert.match(source, /noBodyLeak/);
  assert.match(source, /cleanupRealUiRun\(context\)/);

  const summaryStart = source.indexOf("return {\n    ok:");
  const summaryEnd = source.indexOf("\n  };\n}", summaryStart);
  assert.ok(summaryStart >= 0);
  assert.ok(summaryEnd > summaryStart);
  const summary = source.slice(summaryStart, summaryEnd);
  assert.doesNotMatch(summary, /POSITIVE_MESSAGE|NEGATIVE_MESSAGE|requestId|path|prompt/);
});

test("P2-88C exposes dedicated focused and real-UI commands", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  );
  assert.equal(
    packageJson.scripts["test:p2-88c-curious-shadow"],
    "npm run build && node --test --experimental-strip-types scripts/p2-88c-deterministic-xita-interaction-cue.test.mts scripts/p2-88c-curious-shadow-real-ui.test.mts"
  );
  assert.equal(
    packageJson.scripts["accept:p2-88c-curious-shadow"],
    "npm run build && node --no-warnings scripts/p2-88c-curious-shadow-real-ui.mjs"
  );
});
