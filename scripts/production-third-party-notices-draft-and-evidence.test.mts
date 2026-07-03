import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditProductionThirdPartyNoticesDraftAndEvidence } from "./p2-20v-production-third-party-notices-draft-and-evidence.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = join(repoRoot, ".tmp", "p2-20v-tests");

test("default repo third-party notices draft summary stays blocked and safe", () => {
  const result = auditProductionThirdPartyNoticesDraftAndEvidence({
    repoRoot
  });
  const output = JSON.stringify(result);
  const blockers = result.blockers.join(",");

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.phase, "P2-20V");
  assert.equal(result.audit, "production_third_party_notices_draft_and_evidence");
  assert.equal(result.safeSummaryOnly, true);
  assert.equal(result.exitPolicy, "always_zero");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.draft.basename, "THIRD_PARTY_NOTICES.draft.md");
  assert.equal(result.draft.finalNoticesBasename, "THIRD_PARTY_NOTICES.md");
  assert.equal(result.draft.legalReviewStatus, "pending");
  assert.equal(result.checks.final_third_party_notices.templateTreatedAsFinal, "false");
  assert.match(result.readyChecks.join(","), /draft_notices_shape_ready/);
  assert.match(result.readyChecks.join(","), /evidence_checklist_shape_ready/);

  for (const blocker of [
    "package_version_0_0_0",
    "app_distribution_license_policy_pending",
    "owner_release_approval_missing",
    "legal_review_not_approved",
    "third_party_notices_not_approved",
    "electron_chromium_notices_not_approved",
    "model_license_evidence_missing",
    "runtime_license_evidence_missing",
    "local_llm_production_pack_missing",
    "production_distribution_inventory_not_approved",
    "final_third_party_notices_missing"
  ]) {
    assert.match(blockers, new RegExp(blocker));
  }

  assert.equal(result.evidenceChecklist.electronPackagedRuntimeNotices.status, "pending_packaged_app_evidence");
  assert.deepEqual(result.evidenceChecklist.electronPackagedRuntimeNotices.requiredBasenames, [
    "LICENSE",
    "LICENSES.chromium.html",
    "ffmpeg.dll"
  ]);
  assert.equal(result.evidenceChecklist.qwen25.baseModel.repo, "Qwen/Qwen2.5-1.5B");
  assert.equal(result.evidenceChecklist.qwen25.instructModel.repo, "Qwen/Qwen2.5-1.5B-Instruct");
  assert.equal(result.evidenceChecklist.qwen25.gGufArtifact.repo, "Qwen/Qwen2.5-1.5B-Instruct-GGUF");
  assert.equal(result.evidenceChecklist.llamaCppRuntime.repo, "ggml-org/llama.cpp");
  assert.doesNotMatch(output, new RegExp(escapeRegExp(repoRoot)));
  assert.doesNotMatch(output, /DO_NOT_LEAK/);
  assert.doesNotMatch(output, /SECRET_PROMPT_TEXT/);
});

test("write mode creates only draft and evidence files, never final notices", () => {
  const outputRoot = join(testRoot, "write-mode");
  const result = auditProductionThirdPartyNoticesDraftAndEvidence({
    repoRoot,
    outputRoot,
    write: true
  });
  const draftPath = join(outputRoot, "THIRD_PARTY_NOTICES.draft.md");
  const evidencePath = join(outputRoot, "third-party-notices-evidence.json");
  const finalPath = join(outputRoot, "THIRD_PARTY_NOTICES.md");
  const draftText = readFileSync(draftPath, "utf8");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));

  assert.equal(result.status, "blocked");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(existsSync(draftPath), true);
  assert.equal(existsSync(evidencePath), true);
  assert.equal(existsSync(finalPath), false);
  assert.deepEqual(
    result.writtenArtifacts.map((entry: any) => entry.basename).sort(),
    ["THIRD_PARTY_NOTICES.draft.md", "third-party-notices-evidence.json"].sort()
  );
  assert.match(draftText, /Draft only\./);
  assert.match(draftText, /Legal review pending\./);
  assert.match(draftText, /Do not ship as final THIRD_PARTY_NOTICES\.md\./);
  assert.match(draftText, /Chromium \/ Node \/ ffmpeg Bundled Notices Pending/);
  assert.match(draftText, /Qwen2\.5 1\.5B Base \/ Instruct \/ GGUF Provenance/);
  assert.equal(evidence.status, "draft_legal_pending");
  assert.equal(evidence.qwen25.gGufArtifact.status, "pending_evidence");
});

test("template scaffold is reported as template and cannot satisfy final notices", () => {
  const result = auditProductionThirdPartyNoticesDraftAndEvidence({
    repoRoot,
    localLlmScaffold: {
      scaffoldPresent: true,
      manifestExamplePresent: true,
      manifestJsonPresent: false,
      noticesTemplatePresent: true,
      noticesTemplatePlaceholder: true,
      thirdPartyNoticesPresent: false,
      thirdPartyNoticesPlaceholder: false,
      runtimePresent: false,
      modelPresent: false,
      productionPackPresent: false
    }
  });

  assert.equal(result.draft.templateBasename, "THIRD_PARTY_NOTICES.template.md");
  assert.equal(result.checks.final_third_party_notices.present, "missing");
  assert.equal(result.checks.final_third_party_notices.templateTreatedAsFinal, "false");
  assert.match(result.blockers.join(","), /final_third_party_notices_missing/);
});

test("unsafe paths and sensitive text block without leaking raw values", () => {
  const result = auditProductionThirdPartyNoticesDraftAndEvidence({
    repoRoot,
    packageJson: {
      ...readyPackageJson(),
      supportNote: "SECRET_PROMPT_TEXT USER_MESSAGE_TEXT ASSISTANT_MESSAGE_TEXT"
    },
    packageLock: {
      lockfileVersion: 3,
      packages: {
        "": {
          name: "ai-desktop-pet",
          version: "1.0.0"
        },
        "node_modules/pangu": {
          version: "7.2.1",
          license: "DO_NOT_LEAK_TEST_TOKEN"
        }
      }
    },
    builderConfig: {
      ...readyBuilderConfig(),
      artifactName: "E:\\secret\\DO_NOT_LEAK_TEST_TOKEN-${version}.exe"
    },
    evidence: {
      qwen25Gguf: {
        repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
        file: "C:\\secret\\SECRET_PROMPT_TEXT.gguf",
        revision: "fixed-test-revision",
        license: "Apache-2.0",
        sha256: "a".repeat(64),
        sizeBytes: 1234,
        requestBody: "REQUEST_BODY_TEXT"
      },
      llamaCppRuntime: {
        repo: "ggml-org/llama.cpp",
        releaseTag: "b-test",
        commit: "fixed-test-commit",
        assetName: "DO_NOT_LEAK_TEST_TOKEN.zip",
        platform: "win32-x64",
        backend: "cpu",
        license: "MIT",
        sha256: "b".repeat(64),
        runtimeExeBasenames: ["llama-server.exe"],
        runtimeDllBasenames: ["llama.dll"],
        factCardBody: "FACT_CARD_TEXT"
      }
    }
  });
  const output = JSON.stringify(result);
  const blockers = result.blockers.join(",");

  assert.equal(result.status, "blocked");
  assert.match(blockers, /privacy_local_path_leak/);
  assert.match(blockers, /privacy_secret_leak/);
  assert.match(blockers, /privacy_model_input_leak/);
  assert.match(blockers, /privacy_request_payload_leak/);
  assert.match(blockers, /privacy_conversation_body_leak/);
  assert.match(blockers, /privacy_fact_body_leak/);

  for (const forbidden of [
    /E:\\secret/,
    /C:\\secret/,
    /DO_NOT_LEAK_TEST_TOKEN/,
    /SECRET_PROMPT_TEXT/,
    /REQUEST_BODY_TEXT/,
    /USER_MESSAGE_TEXT/,
    /ASSISTANT_MESSAGE_TEXT/,
    /FACT_CARD_TEXT/
  ]) {
    assert.doesNotMatch(output, forbidden);
  }
});

test("complete fixture evidence can make draft ready checks without a production-ready claim", () => {
  const result = auditProductionThirdPartyNoticesDraftAndEvidence({
    repoRoot,
    packageJson: readyPackageJson(),
    packageLock: readyPackageLock(),
    builderConfig: readyBuilderConfig(),
    localLlmScaffold: readyLocalLlmScaffold(),
    policyEvidence: readyPolicyEvidence(),
    evidence: readyEvidence()
  });
  const readyChecks = result.readyChecks.join(",");

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.productionReadyClaim, false);
  assert.match(readyChecks, /draft_notices_shape_ready/);
  assert.match(readyChecks, /evidence_checklist_shape_ready/);
  assert.match(readyChecks, /qwen25_gguf_evidence_shape_ready/);
  assert.match(readyChecks, /llama_cpp_runtime_evidence_shape_ready/);
  assert.equal(result.evidenceChecklist.qwen25.gGufArtifact.status, "shape_ready_legal_pending");
  assert.equal(result.evidenceChecklist.llamaCppRuntime.status, "shape_ready_legal_pending");
  assert.doesNotMatch(result.blockers.join(","), /package_version_0_0_0/);
  assert.doesNotMatch(result.blockers.join(","), /app_distribution_license_policy_pending/);
  assert.match(result.blockers.join(","), /legal_review_not_approved/);
  assert.match(result.blockers.join(","), /third_party_notices_not_approved/);
  assert.match(result.blockers.join(","), /final_third_party_notices_missing/);
});

test("write mode refuses output outside the repo tmp directory", () => {
  assert.throws(
    () => auditProductionThirdPartyNoticesDraftAndEvidence({
      repoRoot,
      outputRoot: resolve(repoRoot, "..", "p2-20v-outside"),
      write: true
    }),
    /unsafe_output_root/
  );
});

test("package scripts expose draft generation and include focused test in history", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

  assert.equal(
    packageJson.scripts["generate:production-third-party-notices-draft"],
    "node scripts/p2-20v-production-third-party-notices-draft-and-evidence.mjs --write"
  );
  assert.match(
    packageJson.scripts["test:history"],
    /scripts\/production-third-party-notices-draft-and-evidence\.test\.mts/
  );
});

test.after(() => {
  rmSync(testRoot, { recursive: true, force: true });
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

function readyEvidence() {
  return {
    qwen25Gguf: {
      repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
      file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
      revision: "fixed-test-revision",
      license: "Apache-2.0",
      licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
      format: "GGUF",
      quantization: "Q4_K_M",
      sha256: "a".repeat(64),
      sizeBytes: 1_117_320_736
    },
    llamaCppRuntime: {
      repo: "ggml-org/llama.cpp",
      releaseTag: "b-test",
      commit: "fixed-test-commit",
      assetName: "llama-test-win-x64.zip",
      platform: "win32-x64",
      backend: "cpu",
      license: "MIT",
      sha256: "b".repeat(64),
      runtimeExeBasenames: ["llama-server.exe"],
      runtimeDllBasenames: ["llama.dll", "ggml.dll"]
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
