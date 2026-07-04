import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditFinalNoticesEvidencePackageDraft } from "./p2-20y-final-notices-evidence-package-draft.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(repoRoot, ".tmp", "p2-20y-final-notices-evidence-package-draft");
const scriptPath = join(repoRoot, "scripts", "p2-20y-final-notices-evidence-package-draft.mjs");

test("default final notices evidence package draft stays blocked and safe", async () => {
  const result = await auditFinalNoticesEvidencePackageDraft({
    repoRoot
  });
  const output = JSON.stringify(result);
  const blockers = result.blockers.join(",");

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.phase, "P2-20Y");
  assert.equal(result.audit, "final_notices_evidence_package_draft");
  assert.equal(result.safeSummaryOnly, true);
  assert.equal(result.exitPolicy, "always_zero");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.packageDraft.status, "draft_only_legal_pending");
  assert.equal(result.packageDraft.finalNoticesWritePolicy, "forbidden_by_p2_20y");
  assert.equal(result.evidenceSources.productionLicenseInventory, "blocked");
  assert.equal(result.evidenceSources.thirdPartyNoticesDraft, "blocked");
  assert.equal(result.evidenceSources.electronChromiumPackagedArtifact, "blocked");
  assert.equal(result.evidenceSources.electronVersionInstallerNotices, "blocked");
  assert.equal(result.evidenceSources.productionLocalLlmArtifact, "blocked");
  assert.equal(result.evidenceSources.productionReleaseChecklist, "blocked");
  assert.equal(result.evidenceSources.releaseVersionLicensePolicy, "blocked");

  for (const blocker of [
    "package_version_0_0_0",
    "app_distribution_license_policy_pending",
    "owner_release_approval_missing",
    "legal_review_not_approved",
    "third_party_notices_not_approved",
    "final_third_party_notices_missing",
    "electron_chromium_notices_not_approved",
    "model_license_evidence_missing",
    "runtime_license_evidence_missing",
    "local_llm_production_pack_missing",
    "production_release_not_approved"
  ]) {
    assert.match(blockers, new RegExp(blocker));
  }

  assert.match(result.readyChecks.join(","), /final_notices_evidence_package_draft_shape_ready/);
  assert.deepEqual(result.writtenArtifacts, []);
  assert.doesNotMatch(output, new RegExp(escapeRegExp(repoRoot)));
  assert.doesNotMatch(output, /[A-Za-z]:\\/);
  assert.doesNotMatch(output, /DO_NOT_LEAK/);
  assert.doesNotMatch(output, /SECRET_PROMPT_TEXT/);
});

test("CLI defaults to safe JSON and exits zero", () => {
  const cli = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true
  });
  const result = JSON.parse(cli.stdout);

  assert.equal(cli.status, 0);
  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.exitPolicy, "always_zero");
  assert.doesNotMatch(cli.stdout, new RegExp(escapeRegExp(repoRoot)));
  assert.doesNotMatch(cli.stdout, /[A-Za-z]:\\/);
});

test("write mode creates only draft markdown and evidence JSON", async () => {
  rmSync(outputRoot, { recursive: true, force: true });

  const result = await auditFinalNoticesEvidencePackageDraft({
    repoRoot,
    write: true
  });
  const draftPath = join(outputRoot, "final-notices-evidence-package-draft.md");
  const evidencePath = join(outputRoot, "final-notices-evidence-package-draft.json");
  const finalNoticesPath = join(outputRoot, "THIRD_PARTY_NOTICES.md");
  const draftText = readFileSync(draftPath, "utf8");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));

  assert.equal(result.status, "blocked");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(existsSync(draftPath), true);
  assert.equal(existsSync(evidencePath), true);
  assert.equal(existsSync(finalNoticesPath), false);
  assert.deepEqual(
    result.writtenArtifacts.map((entry: any) => entry.basename).sort(),
    ["final-notices-evidence-package-draft.json", "final-notices-evidence-package-draft.md"]
  );
  assert.match(draftText, /Draft only\./);
  assert.match(draftText, /Legal review pending\./);
  assert.match(draftText, /Do not ship as final THIRD_PARTY_NOTICES\.md\./);
  assert.equal(evidence.packageDraft.finalNoticesWritePolicy, "forbidden_by_p2_20y");
  assert.equal(evidence.productionReadyClaim, false);
});

test("cleanup removes the P2-20Y tmp draft output", async () => {
  const result = await auditFinalNoticesEvidencePackageDraft({
    repoRoot,
    write: true,
    cleanup: true
  });

  assert.equal(result.cleanup.status, "removed");
  assert.equal(existsSync(outputRoot), false);
  assert.equal(
    result.writtenArtifacts.every((entry: any) => entry.status === "removed_after_cleanup"),
    true
  );
});

test("unsafe source summaries are blocked without leaking raw values", async () => {
  const result = await auditFinalNoticesEvidencePackageDraft({
    repoRoot,
    sourceAudits: {
      productionLocalLlmArtifact: {
        summary: unsafeAudit("P2-20O", "production_local_llm_artifact")
      },
      productionReleaseChecklist: unsafeAudit("P2-20Q", "production_release_checklist"),
      releaseVersionLicensePolicy: unsafeAudit("P2-20T", "release_version_license_policy"),
      productionLicenseInventory: unsafeAudit("P2-20U", "production_distribution_license_inventory"),
      thirdPartyNoticesDraft: unsafeAudit("P2-20V", "production_third_party_notices_draft_and_evidence"),
      electronChromiumPackagedArtifact: unsafeAudit("P2-20W", "electron_chromium_notices_packaged_artifact"),
      electronVersionInstallerNotices: unsafeAudit("P2-20X", "electron_version_installer_notices")
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
    /plain_token_value/,
    /SECRET_PROMPT_TEXT/,
    /REQUEST_BODY_TEXT/,
    /USER_MESSAGE_TEXT/,
    /ASSISTANT_MESSAGE_TEXT/,
    /FACT_CARD_TEXT/
  ]) {
    assert.doesNotMatch(output, forbidden);
  }
});

test("package scripts expose final notices evidence package draft and focused test", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

  assert.equal(
    packageJson.scripts["generate:final-notices-evidence-package-draft"],
    "node scripts/p2-20y-final-notices-evidence-package-draft.mjs"
  );
  assert.match(
    packageJson.scripts["test:history"],
    /scripts\/final-notices-evidence-package-draft\.test\.mts/
  );
});

test.after(() => {
  rmSync(outputRoot, { recursive: true, force: true });
});

function unsafeAudit(phase: string, audit: string) {
  return {
    ok: false,
    status: "blocked",
    phase,
    audit,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    productionReadyClaim: false,
    blockers: ["existing_blocker", "DO_NOT_LEAK_TEST_TOKEN"],
    warnings: ["E:\\secret\\release.log", "plain_token_value"],
    readyChecks: ["SECRET_PROMPT_TEXT"],
    localPath: "C:\\secret\\FACT_CARD_TEXT.md",
    requestBody: "REQUEST_BODY_TEXT",
    userMessage: "USER_MESSAGE_TEXT",
    assistantMessage: "ASSISTANT_MESSAGE_TEXT",
    factCardBody: "FACT_CARD_TEXT"
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
