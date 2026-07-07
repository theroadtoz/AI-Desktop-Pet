import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditFinalNoticesReleaseApprovalGateDraft } from "./p2-30j-final-notices-and-release-approval-gate-draft.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(repoRoot, ".tmp", "p2-30j-final-notices-release-approval-gate-draft");

test("default repo final notices release approval gate stays blocked and safe", async () => {
  const result = await auditFinalNoticesReleaseApprovalGateDraft({ repoRoot });
  const text = JSON.stringify(result);

  assert.equal(result.status, "blocked");
  assert.equal(result.ok, false);
  assert.equal(result.productionReadyClaim, false);
  assert.equal(result.gate.status, "blocked_draft");
  assert.equal(result.gate.ownerApproval.status, "missing");
  assert.equal(result.gate.legalReview.status, "pending");
  assert.equal(result.gate.releaseApproval.status, "missing");
  assert.match(result.blockers.join(","), /final_third_party_notices_missing/);
  assert.match(result.blockers.join(","), /owner_release_approval_missing/);
  assert.match(result.blockers.join(","), /production_release_not_approved/);
  assert.doesNotMatch(text, /[A-Za-z]:\\/);
  assert.doesNotMatch(text, /Authorization|api[_-]?key|token/i);
  assert.doesNotMatch(text, /user message|assistant message|prompt text|fact card|memory card/i);
});

test("complete-shaped injected sources still remain a manual approval gate draft", async () => {
  const readyAudit = {
    ok: true,
    status: "ready",
    readyChecks: ["ready_shape"],
    blockers: [],
    warnings: []
  };
  const result = await auditFinalNoticesReleaseApprovalGateDraft({
    repoRoot,
    sourceAudits: {
      finalNoticesEvidencePackage: {
        ...readyAudit,
        phase: "P2-20Y",
        audit: "final_notices_evidence_package_draft",
        packageDraft: {
          status: "draft_only_legal_pending",
          productionUse: "blocked",
          legalReviewStatus: "pending",
          ownerApprovalStatus: "missing"
        }
      },
      thirdPartyNoticesDraft: readyAudit,
      productionLicenseInventory: readyAudit,
      releaseVersionLicensePolicy: {
        ...readyAudit,
        policy: {
          ownerApproval: "approved",
          legalReviewStatus: "approved",
          licenseDecisionStatus: "approved"
        }
      },
      productionReleaseChecklist: {
        ...readyAudit,
        releaseManifest: {
          status: "ready"
        }
      },
      localLlmProvenanceEvidence: {
        ...readyAudit,
        modelProvenance: {
          status: "matched_pinned_candidate",
          releaseMetadataStatus: "matches_pinned_candidate"
        },
        runtimeProvenance: {
          status: "matches_pinned_candidate",
          releaseMetadataStatus: "matches_pinned_candidate"
        }
      }
    }
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.productionReadyClaim, false);
  assert.match(result.blockers.join(","), /production_ready_claim_forbidden/);
  assert.match(result.warnings.join(","), /approval_gate_draft_only/);
});

test("write cleanup creates then removes only the P2-30J draft output", async () => {
  rmSync(outputRoot, { recursive: true, force: true });
  const result = await auditFinalNoticesReleaseApprovalGateDraft({
    repoRoot,
    write: true,
    cleanup: true
  });

  assert.equal(result.cleanup.status, "removed");
  assert.equal(result.writtenArtifacts.length, 2);
  assert.equal(result.writtenArtifacts.every((artifact) => artifact.status === "removed_after_cleanup"), true);
  assert.equal(existsSync(outputRoot), false);
});

test("unsafe injected source audit is blocked without leaking raw value", async () => {
  const result = await auditFinalNoticesReleaseApprovalGateDraft({
    repoRoot,
    sourceAudits: {
      finalNoticesEvidencePackage: {
        status: "blocked",
        blockers: ["C:\\Users\\Secret\\private.txt"],
        prompt: "secret_prompt_text"
      }
    }
  });
  const text = JSON.stringify(result);

  assert.match(result.blockers.join(","), /privacy_local_path_leak/);
  assert.match(result.blockers.join(","), /privacy_model_input_leak/);
  assert.doesNotMatch(text, /C:\\Users\\Secret/);
  assert.doesNotMatch(text, /secret_prompt_text/);
});

test("CLI prints safe JSON and exits zero for blocked gate", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/p2-30j-final-notices-and-release-approval-gate-draft.mjs"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);

  assert.equal(parsed.status, "blocked");
  assert.equal(parsed.productionReadyClaim, false);
  assert.match(parsed.blockers.join(","), /production_ready_claim_forbidden/);
});

test("package scripts expose P2-30J gate draft generator and focused test", () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

  assert.match(
    packageJson.scripts["generate:final-notices-release-approval-gate-draft"],
    /p2-30j-final-notices-and-release-approval-gate-draft\.mjs/
  );
  assert.match(
    packageJson.scripts["test:history"],
    /final-notices-release-approval-gate-draft\.test\.mts/
  );
});

test.after(() => {
  rmSync(outputRoot, { recursive: true, force: true });
});
