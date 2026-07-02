import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditCodeSigningProviderCiPlan } from "./p2-20s-code-signing-provider-ci-plan-audit.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("default repo summary stays blocked while the plan is ready and safe", () => {
  const result = auditCodeSigningProviderCiPlan({
    repoRoot,
    env: {}
  });
  const output = JSON.stringify(result);

  assert.equal(result.status, "blocked");
  assert.equal(result.ok, false);
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.planning.status, "ready");
  assert.equal(result.providerPlan.primary, "azure_artifact_signing");
  assert.equal(result.providerPlan.decisionStatus, "planned_not_procured");
  assert.equal(result.ciPlan.workflowStatus, "planned_not_created");
  assert.equal(result.checks.electron_builder_signing_config.status, "ready");
  assert.equal(result.checks.package_win_nsis_publish_policy.publishPolicy, "never");
  assert.equal(result.checks.tracked_signing_and_release_artifacts.trackedArtifactCount, 0);
  assert.equal(result.checks.release_signing_workflows.matchingWorkflowCount, 0);
  assert.match(result.blockers.join(","), /code_signing_provider_not_procured/);
  assert.match(result.blockers.join(","), /artifact_attestation_not_generated/);
  assert.doesNotMatch(output, new RegExp(escapeRegExp(repoRoot)));
  assert.doesNotMatch(output, /DO_NOT_LEAK/);
});

test("unsafe signing config, tracked artifacts, and release workflows are reported without leaking values", () => {
  const result = auditCodeSigningProviderCiPlan({
    repoRoot,
    packageJson: {
      scripts: {
        "package:win:nsis": "npm run build && electron-builder --win nsis"
      }
    },
    builderConfig: {
      forceCodeSigning: true,
      win: {
        certificateFile: "E:\\secret\\DO_NOT_LEAK_TEST_CERT.pfx",
        azureSignOptions: {
          token: "DO_NOT_LEAK_TEST_TOKEN"
        }
      }
    },
    gitTrackedFiles: [
      "package.json",
      "dist/AI Desktop Pet-Setup-1.0.0-x64.exe",
      "certs/DO_NOT_LEAK_TEST_CERT.p12",
      ".tmp/p2-20r/release-manifest.json"
    ],
    workflowFiles: [
      ".github/workflows/release-signing.yml"
    ]
  });
  const output = JSON.stringify(result);

  assert.equal(result.status, "blocked");
  assert.equal(result.ok, false);
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.checks.electron_builder_signing_config.configuredSigning, "present");
  assert.equal(result.checks.package_win_nsis_publish_policy.publishPolicy, "not_never");
  assert.equal(result.checks.tracked_signing_and_release_artifacts.trackedArtifactCount, 3);
  assert.deepEqual(result.checks.tracked_signing_and_release_artifacts.trackedArtifactBasenames, [
    "AI Desktop Pet-Setup-1.0.0-x64.exe",
    "redacted_signing_material",
    "release-manifest.json"
  ]);
  assert.equal(result.checks.release_signing_workflows.workflowStatus, "unexpected_workflow_present");
  assert.deepEqual(result.checks.release_signing_workflows.matchingWorkflowBasenames, ["release-signing.yml"]);
  assert.match(result.blockers.join(","), /real_signing_config_detected/);
  assert.match(result.blockers.join(","), /package_win_nsis_publish_not_never/);
  assert.match(result.blockers.join(","), /tracked_signing_or_release_artifacts/);
  assert.match(result.blockers.join(","), /release_or_signing_workflow_present/);
  assert.doesNotMatch(output, /E:\\secret/);
  assert.doesNotMatch(output, /DO_NOT_LEAK_TEST_CERT/);
  assert.doesNotMatch(output, /DO_NOT_LEAK_TEST_TOKEN/);
  assert.doesNotMatch(output, /\.tmp\/p2-20r/);
});

test("package scripts expose the audit and include the focused test in history", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

  assert.equal(
    packageJson.scripts["audit:code-signing-ci-plan"],
    "node scripts/p2-20s-code-signing-provider-ci-plan-audit.mjs"
  );
  assert.match(packageJson.scripts["test:history"], /scripts\/code-signing-provider-ci-plan-audit\.test\.mts/);
});

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
