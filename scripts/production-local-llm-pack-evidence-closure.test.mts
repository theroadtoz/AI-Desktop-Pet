import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditProductionLocalLlmPackEvidenceClosure } from "./p2-20z-production-local-llm-pack-evidence-closure.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(repoRoot, ".tmp", "p2-20z-production-local-llm-pack-evidence-closure");
const scriptPath = join(repoRoot, "scripts", "p2-20z-production-local-llm-pack-evidence-closure.mjs");

test("default closure audit stays blocked and safe", async () => {
  const result = await auditProductionLocalLlmPackEvidenceClosure({
    repoRoot
  });
  const output = JSON.stringify(result);
  const blockers = result.blockers.join(",");
  const readyChecks = result.readyChecks.join(",");

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.phase, "P2-20Z");
  assert.equal(result.audit, "production_local_llm_pack_evidence_closure");
  assert.equal(result.safeSummaryOnly, true);
  assert.equal(result.exitPolicy, "always_zero");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.candidateEvidence.model.status, "ready");
  assert.equal(result.candidateEvidence.runtime.status, "ready");
  assert.equal(result.repoPackState.gitignore, "present");
  assert.equal(result.repoPackState.manifestExample, "present");
  assert.equal(result.repoPackState.noticesTemplate, "present");
  assertRepoPackState(result.repoPackState);
  assert.equal(result.commandEvidence.status, "ready");
  assert.equal(result.commandEvidence.commands.validateLocalLlm.status, "available");
  assert.equal(result.commandEvidence.commands.dryRunProductionLocalLlmPack.status, "available");
  assert.equal(result.commandEvidence.commands.stageOfflineLocalLlm.status, "available");
  assert.equal(result.commandEvidence.commands.stageElectronBuilderLocalLlm.status, "available");
  assert.equal(result.commandEvidence.commands.acceptElectronBuilderLocalLlm.status, "available");
  assert.equal(result.commandEvidence.commands.acceptNsisInstallerLifecycle.status, "available");
  assert.equal(result.commandEvidence.commands.generateProductionReleaseManifest.status, "available");
  assert.equal(result.sourceStatuses.productionLocalLlmArtifact, "blocked");
  assert.equal(result.sourceStatuses.finalNoticesEvidencePackage, "blocked");
  assert.equal(result.sourceStatuses.productionReleaseChecklist, "blocked");
  assert.equal(result.sourceStatuses.productionLicenseInventory, "blocked");
  assert.equal(result.sourceStatuses.thirdPartyNoticesDraft, "blocked");
  assert.equal(result.sourceStatuses.electronVersionInstallerNotices, "blocked");

  for (const readyCheck of [
    "model_candidate_metadata_pinned",
    "model_candidate_sha256_declared",
    "model_candidate_size_declared",
    "runtime_candidate_release_pinned",
    "runtime_candidate_sha256_declared",
    "runtime_candidate_size_declared",
    "local_llm_scaffold_present",
    "manifest_example_present",
    "notices_template_present",
    "p2_20h_validator_command_available",
    "p2_20i_offline_layout_stage_command_available",
    "p2_20o_artifact_review_available",
    "p2_20p_dry_run_candidate_available",
    "p2_20p_dry_run_command_available",
    "p2_20j_electron_builder_stage_command_available",
    "p2_20j_packaged_chat_acceptance_command_available",
    "p2_20m_nsis_lifecycle_acceptance_command_available",
    "p2_20r_release_manifest_generator_available",
    "p2_20y_final_notices_evidence_available"
  ]) {
    assert.match(readyChecks, new RegExp(readyCheck));
  }

  for (const blocker of [
    "production_local_llm_pack_missing",
    "production_manifest_missing",
    "production_third_party_notices_missing",
    "model_file_missing",
    "runtime_executable_missing",
    "runtime_dlls_missing",
    "model_license_evidence_not_approved",
    "runtime_license_evidence_not_approved",
    "legal_review_not_approved",
    "owner_release_approval_missing",
    "production_release_not_approved",
    "final_third_party_notices_missing"
  ]) {
    assert.match(blockers, new RegExp(blocker));
  }

  assert.deepEqual(result.writtenArtifacts, []);
  assert.doesNotMatch(output, new RegExp(escapeRegExp(repoRoot)));
  assert.doesNotMatch(output, /[A-Za-z]:\\/);
  assert.doesNotMatch(output, /\btoken\b/i);
  assert.doesNotMatch(output, /DO_NOT_LEAK/);
  assert.doesNotMatch(output, /SECRET_PROMPT_TEXT/);
  assert.doesNotMatch(output, /REQUEST_BODY_TEXT/);
  assert.doesNotMatch(output, /USER_MESSAGE_TEXT/);
  assert.doesNotMatch(output, /ASSISTANT_MESSAGE_TEXT/);
  assert.doesNotMatch(output, /FACT_CARD_TEXT/);
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
  assert.match(result.repoPackState.status, /^(scaffold_only|production_files_present_not_approved)$/);
  assert.doesNotMatch(cli.stdout, new RegExp(escapeRegExp(repoRoot)));
  assert.doesNotMatch(cli.stdout, /[A-Za-z]:\\/);
  assert.doesNotMatch(cli.stdout, /\btoken\b/i);
});

test("write mode creates only P2-20Z draft markdown and evidence JSON", async () => {
  rmSync(outputRoot, { recursive: true, force: true });

  const repoFinalNoticesPath = join(repoRoot, "resources", "local-llm", "licenses", "THIRD_PARTY_NOTICES.md");
  const repoFinalNoticesBefore = existsSync(repoFinalNoticesPath)
    ? readFileSync(repoFinalNoticesPath, "utf8")
    : null;

  const result = await auditProductionLocalLlmPackEvidenceClosure({
    repoRoot,
    write: true
  });
  const draftPath = join(outputRoot, "production-local-llm-pack-evidence-closure-draft.md");
  const evidencePath = join(outputRoot, "production-local-llm-pack-evidence-closure.json");
  const finalNoticesPath = join(outputRoot, "THIRD_PARTY_NOTICES.md");
  const draftText = readFileSync(draftPath, "utf8");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));

  assert.equal(result.status, "blocked");
  assert.equal(result.productionReadyClaim, false);
  assert.equal(existsSync(draftPath), true);
  assert.equal(existsSync(evidencePath), true);
  assert.equal(existsSync(finalNoticesPath), false);
  assert.equal(existsSync(repoFinalNoticesPath), repoFinalNoticesBefore !== null);
  if (repoFinalNoticesBefore !== null) {
    assert.equal(readFileSync(repoFinalNoticesPath, "utf8"), repoFinalNoticesBefore);
  }
  assert.deepEqual(
    result.writtenArtifacts.map((entry: any) => entry.basename).sort(),
    [
      "production-local-llm-pack-evidence-closure-draft.md",
      "production-local-llm-pack-evidence-closure.json"
    ]
  );
  assert.match(draftText, /Draft only\./);
  assert.match(draftText, /Audit only\./);
  assert.match(draftText, /Do not ship as final THIRD_PARTY_NOTICES\.md\./);
  assert.equal(evidence.outputPolicy.finalNoticesWritePolicy, "forbidden_by_p2_20z");
  assert.equal(evidence.productionReadyClaim, false);
  assert.doesNotMatch(draftText, new RegExp(escapeRegExp(repoRoot)));
  assert.doesNotMatch(JSON.stringify(evidence), /[A-Za-z]:\\/);
});

test("cleanup removes only the P2-20Z tmp draft output", async () => {
  const result = await auditProductionLocalLlmPackEvidenceClosure({
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

test("unsafe source audit inputs are blocked without leaking raw values", async () => {
  const result = await auditProductionLocalLlmPackEvidenceClosure({
    repoRoot,
    sourceAudits: {
      productionLocalLlmArtifact: {
        summary: unsafeAudit("P2-20O", "production_local_llm_artifact")
      },
      finalNoticesEvidencePackage: unsafeAudit("P2-20Y", "final_notices_evidence_package_draft"),
      productionReleaseChecklist: unsafeAudit("P2-20Q", "production_release_checklist"),
      productionLicenseInventory: unsafeAudit("P2-20U", "production_distribution_license_inventory"),
      thirdPartyNoticesDraft: unsafeAudit("P2-20V", "production_third_party_notices_draft_and_evidence"),
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

test("package scripts expose P2-20Z audit and focused test", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

  assert.equal(
    packageJson.scripts["audit:production-local-llm-pack-evidence-closure"],
    "node scripts/p2-20z-production-local-llm-pack-evidence-closure.mjs"
  );
  assert.match(
    packageJson.scripts["test:history"],
    /scripts\/production-local-llm-pack-evidence-closure\.test\.mts/
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

function assertRepoPackState(repoPackState: any) {
  if (repoPackState.status === "scaffold_only") {
    assert.equal(repoPackState.productionManifest, "missing");
    assert.equal(repoPackState.productionNotices, "missing");
    assert.equal(repoPackState.runtimeExecutable, "missing");
    assert.equal(repoPackState.runtimeDlls, "missing");
    assert.equal(repoPackState.modelFile, "missing");
    assert.equal(repoPackState.productionPack, "missing");
    return;
  }

  assert.equal(repoPackState.status, "production_files_present_not_approved");
  assert.equal(repoPackState.productionManifest, "present_not_approved");
  assert.equal(repoPackState.productionNotices, "present_not_approved");
  assert.equal(repoPackState.runtimeExecutable, "present_not_approved");
  assert.equal(repoPackState.runtimeDlls, "present_not_approved");
  assert.equal(repoPackState.modelFile, "present_not_approved");
  assert.equal(repoPackState.productionPack, "present_not_approved");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
