import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditReleaseVersionLicensePolicy } from "./p2-20t-release-version-license-policy-audit.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("default repo release version and license policy summary stays blocked and safe", () => {
  const result = auditReleaseVersionLicensePolicy({
    repoRoot
  });
  const output = JSON.stringify(result);

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.phase, "P2-20T");
  assert.equal(result.audit, "release_version_license_policy");
  assert.equal(result.safeSummaryOnly, true);
  assert.equal(result.exitPolicy, "always_zero");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.policy.status, "planned");
  assert.equal(result.policy.licenseDecisionStatus, "pending_owner_decision");
  assert.equal(result.checks.package_metadata.version, "0.0.0");
  assert.equal(result.checks.package_metadata.license, "UNLICENSED");
  assert.equal(result.checks.package_metadata.privatePackage, "true");
  assert.equal(result.checks.electron_builder_artifact_version_patterns.status, "ready");
  assert.match(result.blockers.join(","), /package_version_0_0_0/);
  assert.match(result.blockers.join(","), /production_version_not_declared/);
  assert.match(result.blockers.join(","), /app_distribution_license_policy_pending/);
  assert.match(result.blockers.join(","), /release_tag_not_created/);
  assert.match(result.blockers.join(","), /third_party_notices_not_approved/);
  assert.match(result.blockers.join(","), /model_license_evidence_missing/);
  assert.match(result.blockers.join(","), /runtime_license_evidence_missing/);
  assert.doesNotMatch(result.blockers.join(","), /package_private_true/);
  assert.doesNotMatch(output, new RegExp(escapeRegExp(repoRoot)));
  assert.doesNotMatch(output, /DO_NOT_LEAK/);
  assert.doesNotMatch(output, /SECRET_PROMPT_TEXT/);
});

test("complete injected policy evidence can pass the policy audit shape without a production-ready claim", () => {
  const result = auditReleaseVersionLicensePolicy({
    repoRoot,
    packageJson: readyPackageJson(),
    builderConfig: readyBuilderConfig(),
    policyEvidence: readyPolicyEvidence(),
    releaseTag: "v1.0.0"
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.policy.status, "ready");
  assert.equal(result.policy.scope, "policy_audit_only");
  assert.equal(result.policy.licenseDecisionStatus, "approved");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.checks.policy_evidence.thirdPartyNotices.file, "THIRD_PARTY_NOTICES.md");
  assert.equal(result.checks.policy_evidence.modelLicenses.entryCount, 1);
  assert.equal(result.checks.policy_evidence.runtimeLicenses.entryCount, 1);
});

test("version tag and artifact version pattern mismatches stay blocked", () => {
  const result = auditReleaseVersionLicensePolicy({
    repoRoot,
    packageJson: readyPackageJson(),
    builderConfig: {
      artifactName: "${productName}-${arch}.${ext}",
      nsis: {
        artifactName: "${productName}-Setup-${version}-${arch}.${ext}"
      },
      portable: {
        artifactName: "${productName}-Portable-${arch}.${ext}"
      }
    },
    policyEvidence: readyPolicyEvidence(),
    releaseTag: "v1.0.1"
  });
  const blockers = result.blockers.join(",");

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.productionReadyClaim, false);
  assert.match(blockers, /release_tag_version_mismatch/);
  assert.match(blockers, /artifactName_artifact_name_version_token_missing/);
  assert.match(blockers, /portable_artifact_name_version_token_missing/);
  assert.equal(
    result.checks.electron_builder_artifact_version_patterns.artifactNames.nsis.versionToken,
    "present"
  );
});

test("unsafe and sensitive injected values are blocked without leaking their contents", () => {
  const result = auditReleaseVersionLicensePolicy({
    repoRoot,
    packageJson: readyPackageJson(),
    builderConfig: {
      artifactName: "E:\\secret\\DO_NOT_LEAK_TEST_TOKEN-${version}.exe",
      nsis: {
        artifactName: "SECRET_PROMPT_TEXT-${version}.exe"
      },
      portable: {
        artifactName: "${productName}-Portable-${version}-${arch}.${ext}"
      }
    },
    policyEvidence: {
      ...readyPolicyEvidence(),
      legalReviewStatus: "approved",
      thirdPartyNotices: {
        approved: true,
        included: true,
        file: "C:\\secret\\FACT_CARD_TEXT.md"
      },
      modelLicenses: {
        approved: true,
        entries: [
          {
            name: "model",
            note: "USER_MESSAGE_TEXT"
          }
        ]
      },
      runtimeLicenses: {
        approved: true,
        entries: [
          {
            name: "runtime",
            note: "REQUEST_BODY_TEXT"
          }
        ]
      }
    },
    releaseTag: "v1.0.0-DO_NOT_LEAK_TEST_TOKEN"
  });
  const output = JSON.stringify(result);

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(","), /privacy_local_path_leak/);
  assert.match(result.blockers.join(","), /privacy_secret_leak/);
  assert.match(result.blockers.join(","), /privacy_model_input_leak/);
  assert.match(result.blockers.join(","), /privacy_request_payload_leak/);
  assert.match(result.blockers.join(","), /privacy_conversation_body_leak/);
  assert.match(result.blockers.join(","), /privacy_fact_body_leak/);
  assert.match(result.blockers.join(","), /release_tag_invalid_or_unsafe/);
  assert.match(result.blockers.join(","), /third_party_notices_file_not_basename/);
  assert.doesNotMatch(output, /E:\\secret/);
  assert.doesNotMatch(output, /C:\\secret/);
  assert.doesNotMatch(output, /DO_NOT_LEAK_TEST_TOKEN/);
  assert.doesNotMatch(output, /SECRET_PROMPT_TEXT/);
  assert.doesNotMatch(output, /REQUEST_BODY_TEXT/);
  assert.doesNotMatch(output, /USER_MESSAGE_TEXT/);
  assert.doesNotMatch(output, /FACT_CARD_TEXT/);
});

test("package scripts expose the audit and include the focused test in history", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

  assert.equal(
    packageJson.scripts["audit:release-version-license-policy"],
    "node scripts/p2-20t-release-version-license-policy-audit.mjs"
  );
  assert.match(packageJson.scripts["test:history"], /scripts\/release-version-license-policy-audit\.test\.mts/);
});

function readyPackageJson() {
  return {
    name: "ai-desktop-pet",
    version: "1.0.0",
    private: false,
    license: "MIT"
  };
}

function readyBuilderConfig() {
  return {
    artifactName: "${productName}-${version}-${arch}.${ext}",
    nsis: {
      artifactName: "${productName}-Setup-${version}-${arch}.${ext}"
    },
    portable: {
      artifactName: "${productName}-Portable-${version}-${arch}.${ext}"
    }
  };
}

function readyPolicyEvidence() {
  return {
    ownerApproval: true,
    legalReviewStatus: "approved",
    licenseDecisionStatus: "approved",
    thirdPartyNotices: {
      approved: true,
      included: true,
      file: "THIRD_PARTY_NOTICES.md"
    },
    modelLicenses: {
      approved: true,
      entries: [
        {
          name: "qwen2.5-fixture",
          license: "Apache-2.0"
        }
      ]
    },
    runtimeLicenses: {
      approved: true,
      entries: [
        {
          name: "llama.cpp-fixture",
          license: "MIT"
        }
      ]
    }
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
