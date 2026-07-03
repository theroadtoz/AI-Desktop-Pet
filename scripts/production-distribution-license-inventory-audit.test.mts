import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditProductionDistributionLicenseInventory } from "./p2-20u-production-distribution-license-inventory-audit.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("default repo production distribution license inventory stays blocked and safe", () => {
  const result = auditProductionDistributionLicenseInventory({
    repoRoot
  });
  const output = JSON.stringify(result);
  const blockers = result.blockers.join(",");

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.phase, "P2-20U");
  assert.equal(result.audit, "production_distribution_license_inventory");
  assert.equal(result.safeSummaryOnly, true);
  assert.equal(result.exitPolicy, "always_zero");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.checks.package_lock_license_coverage.status, "ready");
  assert.equal(result.inventory.packageMetadata.packageLockLicenseCoverage.missingLicenseCount, 0);
  assert.equal(result.inventory.packageMetadata.packageLockLicenseCoverage.unknownLicenseCount, 0);
  assert.match(result.readyChecks.join(","), /package_lock_license_fields_present/);
  assert.match(blockers, /package_version_0_0_0/);
  assert.match(blockers, /app_distribution_license_policy_pending/);
  assert.match(blockers, /owner_release_approval_missing/);
  assert.match(blockers, /legal_review_not_approved/);
  assert.match(blockers, /third_party_notices_not_approved/);
  assert.match(blockers, /third_party_notices_file_missing/);
  assert.match(blockers, /electron_chromium_notices_not_approved/);
  assert.match(blockers, /model_license_evidence_missing/);
  assert.match(blockers, /runtime_license_evidence_missing/);
  assert.match(blockers, /local_llm_production_pack_missing/);
  assert.match(blockers, /production_distribution_inventory_not_approved/);
  assert.equal(
    result.inventory.runtimeShippedEntries.some((entry: any) => entry.id === "electron-runtime"),
    true
  );
  assert.equal(
    result.inventory.runtimeShippedEntries.some((entry: any) => entry.id === "pangu-runtime-dependency"),
    true
  );
  assert.equal(
    result.inventory.localLlmEntries.some((entry: any) => entry.id === "llama-cpp-runtime-candidate"),
    true
  );
  assert.doesNotMatch(output, new RegExp(escapeRegExp(repoRoot)));
  assert.doesNotMatch(output, /DO_NOT_LEAK/);
  assert.doesNotMatch(output, /SECRET_PROMPT_TEXT/);
});

test("complete injected fixture can make the inventory audit shape ready without a production-ready claim", () => {
  const result = auditProductionDistributionLicenseInventory({
    repoRoot,
    packageJson: readyPackageJson(),
    packageLock: readyPackageLock(),
    builderConfig: readyBuilderConfig(),
    localLlmScaffold: readyLocalLlmScaffold(),
    policyEvidence: readyPolicyEvidence()
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.equal(result.productionReadyClaim, false);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.checks.package_lock_license_coverage.status, "ready");
  assert.equal(result.checks.local_llm_scaffold.status, "ready");
  assert.equal(result.checks.distribution_policy_evidence.status, "ready");
  assert.match(result.readyChecks.join(","), /package_lock_license_fields_present/);
  assert.match(result.readyChecks.join(","), /runtime_dependency_pangu_identified/);
  assert.match(result.readyChecks.join(","), /build_time_tools_identified/);
  assert.match(result.readyChecks.join(","), /local_llm_scaffold_present/);
  assert.match(result.readyChecks.join(","), /electron_builder_distribution_inputs_identified/);
});

test("missing package-lock licenses, unknown licenses, unsafe paths, and sensitive text block without leaks", () => {
  const result = auditProductionDistributionLicenseInventory({
    repoRoot,
    packageJson: {
      ...readyPackageJson(),
      supportNote: "SECRET_PROMPT_TEXT USER_MESSAGE_TEXT"
    },
    packageLock: {
      lockfileVersion: 3,
      packages: {
        "": {
          name: "ai-desktop-pet",
          version: "1.0.0"
        },
        "node_modules/missing-license": {
          version: "1.0.0"
        },
        "node_modules/mystery-license": {
          version: "1.0.0",
          license: "Mystery-1.0"
        },
        "node_modules/secret-license": {
          version: "1.0.0",
          license: "DO_NOT_LEAK_TEST_TOKEN"
        }
      }
    },
    builderConfig: {
      ...readyBuilderConfig(),
      artifactName: "E:\\secret\\DO_NOT_LEAK_TEST_TOKEN-${version}.exe"
    },
    localLlmScaffold: readyLocalLlmScaffold(),
    policyEvidence: {
      ...readyPolicyEvidence(),
      requestBody: "REQUEST_BODY_TEXT",
      factCardBody: "FACT_CARD_TEXT"
    }
  });
  const output = JSON.stringify(result);
  const blockers = result.blockers.join(",");

  assert.equal(result.status, "blocked");
  assert.match(blockers, /package_lock_license_fields_missing/);
  assert.match(blockers, /package_lock_unknown_license/);
  assert.match(blockers, /package_lock_license_fields_unsafe/);
  assert.match(blockers, /privacy_local_path_leak/);
  assert.match(blockers, /privacy_secret_leak/);
  assert.match(blockers, /privacy_model_input_leak/);
  assert.match(blockers, /privacy_request_payload_leak/);
  assert.match(blockers, /privacy_conversation_body_leak/);
  assert.match(blockers, /privacy_fact_body_leak/);
  assert.doesNotMatch(output, /E:\\secret/);
  assert.doesNotMatch(output, /DO_NOT_LEAK_TEST_TOKEN/);
  assert.doesNotMatch(output, /SECRET_PROMPT_TEXT/);
  assert.doesNotMatch(output, /REQUEST_BODY_TEXT/);
  assert.doesNotMatch(output, /USER_MESSAGE_TEXT/);
  assert.doesNotMatch(output, /FACT_CARD_TEXT/);
});

test("local LLM notices missing or placeholder and model/runtime evidence missing stay blocked", () => {
  const missing = auditProductionDistributionLicenseInventory({
    repoRoot,
    packageJson: readyPackageJson(),
    packageLock: readyPackageLock(),
    builderConfig: readyBuilderConfig(),
    localLlmScaffold: {
      ...readyLocalLlmScaffold(),
      thirdPartyNoticesPresent: false,
      thirdPartyNoticesPlaceholder: false,
      productionPackPresent: false
    },
    policyEvidence: {
      ...readyPolicyEvidence(),
      modelLicenses: undefined,
      runtimeLicenses: undefined
    }
  });
  const placeholder = auditProductionDistributionLicenseInventory({
    repoRoot,
    packageJson: readyPackageJson(),
    packageLock: readyPackageLock(),
    builderConfig: readyBuilderConfig(),
    localLlmScaffold: {
      ...readyLocalLlmScaffold(),
      thirdPartyNoticesPresent: true,
      thirdPartyNoticesPlaceholder: true,
      productionPackPresent: false
    },
    policyEvidence: {
      ...readyPolicyEvidence(),
      modelLicenses: undefined,
      runtimeLicenses: undefined
    }
  });

  assert.equal(missing.status, "blocked");
  assert.match(missing.blockers.join(","), /third_party_notices_file_missing/);
  assert.match(missing.blockers.join(","), /model_license_evidence_missing/);
  assert.match(missing.blockers.join(","), /runtime_license_evidence_missing/);
  assert.match(missing.blockers.join(","), /local_llm_production_pack_missing/);
  assert.equal(placeholder.status, "blocked");
  assert.match(placeholder.blockers.join(","), /third_party_notices_placeholder/);
  assert.match(placeholder.blockers.join(","), /model_license_evidence_missing/);
  assert.match(placeholder.blockers.join(","), /runtime_license_evidence_missing/);
});

test("package scripts expose production license inventory audit and include the focused test in history", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

  assert.equal(
    packageJson.scripts["audit:production-license-inventory"],
    "node scripts/p2-20u-production-distribution-license-inventory-audit.mjs"
  );
  assert.match(
    packageJson.scripts["test:history"],
    /scripts\/production-distribution-license-inventory-audit\.test\.mts/
  );
});

function readyPackageJson() {
  return {
    name: "ai-desktop-pet",
    version: "1.0.0",
    private: false,
    license: "MIT",
    dependencies: {
      pangu: "^7.2.1"
    },
    devDependencies: {
      electron: "42.4.0",
      "electron-builder": "^26.15.3",
      typescript: "^5.9.3",
      vite: "^8.0.16"
    }
  };
}

function readyPackageLock() {
  return {
    lockfileVersion: 3,
    packages: {
      "": {
        name: "ai-desktop-pet",
        version: "1.0.0"
      },
      "node_modules/electron": {
        version: "42.4.0",
        license: "MIT",
        dev: true
      },
      "node_modules/electron-builder": {
        version: "26.15.3",
        license: "MIT",
        dev: true
      },
      "node_modules/pangu": {
        version: "7.2.1",
        license: "MIT"
      },
      "node_modules/typescript": {
        version: "5.9.3",
        license: "Apache-2.0",
        dev: true
      },
      "node_modules/vite": {
        version: "8.0.16",
        license: "MIT",
        dev: true
      }
    }
  };
}

function readyBuilderConfig() {
  return {
    files: [
      "dist/**/*",
      "package.json",
      "node_modules/pangu/**/*"
    ],
    extraResources: [
      {
        from: ".tmp/p2-20j-extra-resources/local-llm",
        to: "local-llm"
      },
      {
        from: "resources/icons/app-icon-256.png",
        to: "icons/app-icon-256.png"
      }
    ],
    win: {
      icon: "resources/icons/app-icon.ico"
    }
  };
}

function readyLocalLlmScaffold() {
  return {
    scaffoldPresent: true,
    manifestExamplePresent: true,
    manifestJsonPresent: true,
    noticesTemplatePresent: true,
    noticesTemplatePlaceholder: true,
    thirdPartyNoticesPresent: true,
    thirdPartyNoticesPlaceholder: false,
    runtimePresent: true,
    modelPresent: true,
    productionPackPresent: true
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
    electronChromiumNoticesApproved: true,
    modelLicenses: {
      approved: true,
      entries: [
        {
          name: "Qwen2.5 1.5B",
          license: "Apache-2.0"
        }
      ]
    },
    runtimeLicenses: {
      approved: true,
      entries: [
        {
          name: "llama.cpp",
          license: "MIT"
        }
      ]
    },
    productionDistributionInventoryApproved: true
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
