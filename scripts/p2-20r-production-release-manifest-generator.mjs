import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const PHASE = "P2-20R";
const GENERATOR_NAME = "production_release_manifest_generator";
const WORK_ROOT_NAME = "p2-20r-production-release-manifest-generator";
const RELEASE_MANIFEST_NAME = "release-manifest.json";
const CHECKSUMS_NAME = "SHA256SUMS.txt";
const DEFAULT_APP_NAME = "AI Desktop Pet";
const DEFAULT_VERSION = "0.0.0";
const DEFAULT_ARCH = "x64";
const DEFAULT_MODEL = Object.freeze({
  repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
  file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
  license: "Apache-2.0",
  sha256: "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
  sizeBytes: 1_117_320_736
});
const DEFAULT_RUNTIME = Object.freeze({
  name: "llama.cpp",
  license: "MIT",
  releaseTag: "b9859",
  releaseOrCommit: "4fc4ec5541b243957ae5099edb67372f8f3b550e",
  sha256: "c9aa80f233a7d1749341860f11723b912d4cfd6eec19434c3d00bba0abc9f85c",
  sizeBytes: 17_478_474
});

export function getRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function getDefaultWorkRoot(repoRoot = getRepoRoot()) {
  return join(repoRoot, ".tmp", WORK_ROOT_NAME);
}

export async function generateProductionReleaseManifest(options = {}) {
  const startedAt = Date.now();
  const repoRoot = options.repoRoot ? resolve(options.repoRoot) : getRepoRoot();
  const workRoot = options.workRoot ? resolve(options.workRoot) : getDefaultWorkRoot(repoRoot);
  const outputRoot = options.outputRoot ? resolve(options.outputRoot) : join(workRoot, "release");
  const fixtureRoot = join(workRoot, "fixture-artifact");
  const keepTmp = options.keepTmp === true;
  const fixtureMode = !readNonEmptyString(options.artifactPath);
  const cleanupTargets = fixtureMode ? [outputRoot, fixtureRoot, workRoot] : [outputRoot];
  let finalResult;

  assertSafeTmpRoot(workRoot, repoRoot, "p2_20r_work_root_outside_repo_tmp");
  assertSafeTmpRoot(outputRoot, repoRoot, "p2_20r_output_root_outside_repo_tmp");

  try {
    const version = readSafeIdentifier(options.version) ?? DEFAULT_VERSION;
    const artifactName = resolveArtifactName(options.artifactName, version);
    const artifactPath = fixtureMode
      ? createFixtureArtifact(fixtureRoot, artifactName, version)
      : resolveExplicitArtifactPath(options.artifactPath);

    if (!isExistingFile(artifactPath)) {
      finalResult = createBlockedResult({
        reason: "artifact_missing",
        artifactName,
        fixtureMode,
        outputRoot,
        keepTmp,
        durationMs: Date.now() - startedAt
      });
      return finalResult;
    }

    const artifactIntegrity = await fileIntegrity(artifactPath);
    const manifest = createReleaseManifest({
      artifactName,
      artifactIntegrity,
      fixtureMode,
      options,
      version
    });
    const checksumsText = createChecksumsText(artifactName, artifactIntegrity);
    const unsafeCodes = findUnsafeGeneratedContent({
      summaryProbe: createSummaryProbe(manifest),
      manifest,
      checksumsText
    });
    const evidenceBlockers = collectEvidenceBlockers(manifest);
    const blockers = uniqueIssueCodes([...evidenceBlockers, ...unsafeCodes]);
    const warnings = uniqueIssueCodes(fixtureMode ? ["fixture_artifact_only"] : []);
    const status = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready";

    manifest.status = status;
    manifest.ok = status === "ready";
    manifest.blockers = blockers;
    manifest.warnings = warnings;

    if (unsafeCodes.length > 0) {
      finalResult = createBlockedResult({
        reason: "unsafe_generated_content",
        blockers,
        warnings,
        artifactName,
        artifactIntegrity,
        fixtureMode,
        outputRoot,
        keepTmp,
        durationMs: Date.now() - startedAt
      });
      return finalResult;
    }

    const writtenArtifacts = writeReleaseArtifacts(outputRoot, manifest, checksumsText);
    const summary = createSummary({
      status,
      blockers,
      warnings,
      artifactName,
      artifactIntegrity,
      fixtureMode,
      outputRoot,
      writtenArtifacts,
      keepTmp,
      durationMs: Date.now() - startedAt
    });

    finalResult = {
      ok: status === "ready",
      status,
      summary,
      releaseManifest: manifest,
      checksumsText
    };
    return finalResult;
  } finally {
    if (keepTmp) {
      if (finalResult?.summary) {
        finalResult.summary.cleanup = {
          tmp: "kept",
          workRootName: basename(workRoot)
        };
      }
    } else {
      cleanupRunTargets(cleanupTargets, repoRoot);

      if (finalResult?.summary) {
        finalResult.summary.cleanup = {
          tmp: "removed",
          workRootName: basename(workRoot)
        };
      }
    }
  }
}

function createFixtureArtifact(fixtureRoot, artifactName, version) {
  assertSafeBasename(artifactName, "p2_20r_artifact_name_not_basename");
  mkdirSync(fixtureRoot, { recursive: true });
  const artifactPath = join(fixtureRoot, artifactName);
  const content = [
    "P2-20R fixture installer artifact.",
    "This is not a production binary.",
    `version=${version}`,
    `artifact=${artifactName}`
  ].join("\n");

  writeFileSync(artifactPath, `${content}\n`, "utf8");
  return artifactPath;
}

function resolveExplicitArtifactPath(artifactPath) {
  const value = readNonEmptyString(artifactPath);

  if (!value) {
    throw new Error("p2_20r_artifact_path_missing");
  }

  if (normalizeSlashes(value).toLowerCase().includes(".env.local")) {
    throw new Error("p2_20r_artifact_path_forbidden");
  }

  return resolve(value);
}

function createReleaseManifest({ artifactName, artifactIntegrity, fixtureMode, options, version }) {
  const fakeReadyEvidence = options.fakeReadyEvidence === true || options.evidenceMode === "fake-ready";
  const signing = normalizeSigningEvidence(options.signing, fakeReadyEvidence);
  const githubRelease = normalizeGitHubReleaseEvidence(options.githubRelease, fakeReadyEvidence, {
    artifactName,
    artifactIntegrity,
    version
  });
  const attestation = normalizeAttestationEvidence(options.attestation, fakeReadyEvidence, artifactIntegrity);
  const legalReviewStatus = readSafeStatus(options.legalReviewStatus) ?? (fakeReadyEvidence ? "approved" : "pending");

  return removeUndefined({
    manifestVersion: 1,
    generatorPhase: PHASE,
    appName: DEFAULT_APP_NAME,
    version,
    commit: readSafeIdentifier(options.commit) ?? readGitCommitShort(getRepoRoot()) ?? "unknown",
    buildTimeUtc: readIsoDate(options.buildTimeUtc) ?? new Date().toISOString(),
    artifactName,
    artifactKind: "nsis-installer",
    target: "nsis",
    arch: readSafeIdentifier(options.arch) ?? DEFAULT_ARCH,
    sha256: artifactIntegrity.sha256,
    sizeBytes: artifactIntegrity.sizeBytes,
    productionReadyClaim: false,
    fixtureOnly: fixtureMode,
    signed: signing.signed,
    signingStatus: signing.signingStatus,
    publisher: signing.publisher,
    timestamped: signing.timestamped,
    smartScreenClaim: readSafeStatus(options.smartScreenClaim) ?? "not_claimed",
    githubRelease,
    attestation,
    legalReviewStatus,
    notices: normalizeNotices(options.notices),
    model: normalizeModel(options.model),
    runtime: normalizeRuntime(options.runtime),
    checksums: {
      file: CHECKSUMS_NAME,
      entries: [
        {
          name: artifactName,
          sha256: artifactIntegrity.sha256,
          sizeBytes: artifactIntegrity.sizeBytes
        }
      ]
    },
    privacyRedaction: {
      localPaths: "forbidden",
      apiKeys: "forbidden",
      prompts: "forbidden",
      conversationText: "forbidden",
      userMemoryText: "forbidden"
    },
    status: "blocked",
    ok: false,
    blockers: [],
    warnings: []
  });
}

function normalizeSigningEvidence(signing, fakeReadyEvidence) {
  if (fakeReadyEvidence) {
    return {
      signed: true,
      signingStatus: "signed_timestamped_verified",
      publisher: "Example Fixture Publisher",
      timestamped: true
    };
  }

  return {
    signed: signing?.signed === true,
    signingStatus: readSafeStatus(signing?.signingStatus) ?? "unsigned_fixture_only",
    publisher: readSafePublicText(signing?.publisher),
    timestamped: signing?.timestamped === true
  };
}

function normalizeGitHubReleaseEvidence(release, fakeReadyEvidence, artifact) {
  if (fakeReadyEvidence) {
    return {
      url: `https://github.com/example/ai-desktop-pet/releases/tag/v${artifact.version}`,
      tag: `v${artifact.version}`,
      draft: false,
      prerelease: false,
      assets: [
        {
          name: artifact.artifactName,
          sha256: artifact.artifactIntegrity.sha256,
          sizeBytes: artifact.artifactIntegrity.sizeBytes
        }
      ]
    };
  }

  if (!release || typeof release !== "object" || Array.isArray(release)) {
    return undefined;
  }

  const url = readPublicHttpsUrl(release.url);
  const tag = readSafeIdentifier(release.tag);
  const assets = Array.isArray(release.assets)
    ? release.assets.map((asset) => normalizeReleaseAsset(asset)).filter(Boolean)
    : [];

  return removeUndefined({
    url,
    tag,
    draft: release.draft === false ? false : undefined,
    prerelease: release.prerelease === false ? false : undefined,
    assets
  });
}

function normalizeAttestationEvidence(attestation, fakeReadyEvidence, artifactIntegrity) {
  if (fakeReadyEvidence) {
    return {
      status: "verified",
      url: "https://github.com/example/ai-desktop-pet/attestations/1",
      subjectSha256: artifactIntegrity.sha256,
      predicateType: "https://slsa.dev/provenance/v1"
    };
  }

  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
    return undefined;
  }

  return removeUndefined({
    status: readSafeStatus(attestation.status),
    url: readPublicHttpsUrl(attestation.url),
    subjectSha256: readSha256(attestation.subjectSha256),
    predicateType: readPublicHttpsUrl(attestation.predicateType)
  });
}

function normalizeReleaseAsset(asset) {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
    return null;
  }

  const name = readBasenameOnly(asset.name);
  const sha256 = readSha256(asset.sha256);
  const sizeBytes = readPositiveInteger(asset.sizeBytes);

  if (!name || !sha256 || sizeBytes === null) {
    return null;
  }

  return {
    name,
    sha256,
    sizeBytes
  };
}

function normalizeNotices(notices) {
  const file = readBasenameOnly(notices?.file) ?? "THIRD_PARTY_NOTICES.md";

  return {
    file,
    included: notices?.included === false ? false : true
  };
}

function normalizeModel(model) {
  return {
    repo: readSafePublicText(model?.repo) ?? DEFAULT_MODEL.repo,
    file: readBasenameOnly(model?.file) ?? DEFAULT_MODEL.file,
    license: readSafeIdentifier(model?.license) ?? DEFAULT_MODEL.license,
    sha256: readSha256(model?.sha256) ?? DEFAULT_MODEL.sha256,
    sizeBytes: readPositiveInteger(model?.sizeBytes) ?? DEFAULT_MODEL.sizeBytes
  };
}

function normalizeRuntime(runtime) {
  return {
    name: readSafeIdentifier(runtime?.name) ?? DEFAULT_RUNTIME.name,
    license: readSafeIdentifier(runtime?.license) ?? DEFAULT_RUNTIME.license,
    releaseTag: readSafeIdentifier(runtime?.releaseTag) ?? DEFAULT_RUNTIME.releaseTag,
    releaseOrCommit: readSafeIdentifier(runtime?.releaseOrCommit) ?? DEFAULT_RUNTIME.releaseOrCommit,
    sha256: readSha256(runtime?.sha256) ?? DEFAULT_RUNTIME.sha256,
    sizeBytes: readPositiveInteger(runtime?.sizeBytes) ?? DEFAULT_RUNTIME.sizeBytes
  };
}

function collectEvidenceBlockers(manifest) {
  const blockers = [];

  if (manifest.signed !== true || !["signed_timestamped_verified", "signed_verified"].includes(manifest.signingStatus)) {
    blockers.push("production_signing_missing");
  }

  if (manifest.timestamped !== true || manifest.signingStatus !== "signed_timestamped_verified") {
    blockers.push("production_timestamp_missing");
  }

  if (!readNonEmptyString(manifest.publisher)) {
    blockers.push("production_publisher_missing");
  }

  if (!manifest.githubRelease) {
    blockers.push("github_release_missing");
  }

  if (!manifest.attestation) {
    blockers.push("production_attestation_missing");
  }

  if (manifest.legalReviewStatus !== "approved") {
    blockers.push("production_legal_review_not_approved");
  }

  return blockers;
}

function createChecksumsText(artifactName, artifactIntegrity) {
  return `${artifactIntegrity.sha256}  ${artifactName}\n`;
}

function writeReleaseArtifacts(outputRoot, manifest, checksumsText) {
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(join(outputRoot, RELEASE_MANIFEST_NAME), `${JSON.stringify(removeUndefined(manifest), null, 2)}\n`, "utf8");
  writeFileSync(join(outputRoot, CHECKSUMS_NAME), checksumsText, "utf8");

  return [
    { basename: RELEASE_MANIFEST_NAME, status: "written" },
    { basename: CHECKSUMS_NAME, status: "written" }
  ];
}

function createSummary({
  status,
  blockers,
  warnings,
  artifactName,
  artifactIntegrity,
  fixtureMode,
  outputRoot,
  writtenArtifacts,
  keepTmp,
  durationMs
}) {
  return removeUndefined({
    ok: status === "ready",
    status,
    phase: PHASE,
    generator: GENERATOR_NAME,
    safeSummaryOnly: true,
    exitPolicy: "always_zero",
    productionReadyClaim: false,
    fixtureMode,
    outputRootName: basename(outputRoot),
    artifact: {
      basename: artifactName,
      sha256: artifactIntegrity.sha256,
      sizeBytes: artifactIntegrity.sizeBytes,
      source: fixtureMode ? "generated_fixture" : "explicit_local_artifact"
    },
    releaseManifest: {
      basename: RELEASE_MANIFEST_NAME,
      status: "written"
    },
    checksums: {
      basename: CHECKSUMS_NAME,
      status: "written"
    },
    blockers,
    warnings,
    writtenArtifacts,
    keepTmp,
    durationMs
  });
}

function createBlockedResult({
  reason,
  blockers,
  warnings,
  artifactName,
  artifactIntegrity,
  fixtureMode,
  outputRoot,
  keepTmp,
  durationMs
}) {
  const finalBlockers = uniqueIssueCodes(blockers ?? [reason]);
  const summary = createSummary({
    status: "blocked",
    blockers: finalBlockers,
    warnings: warnings ?? [],
    artifactName: artifactName ?? "missing",
    artifactIntegrity: artifactIntegrity ?? { sha256: undefined, sizeBytes: undefined },
    fixtureMode,
    outputRoot,
    writtenArtifacts: [],
    keepTmp,
    durationMs
  });

  return {
    ok: false,
    status: "blocked",
    summary,
    releaseManifest: null,
    checksumsText: ""
  };
}

function createSummaryProbe(manifest) {
  return {
    phase: PHASE,
    generator: GENERATOR_NAME,
    productionReadyClaim: false,
    artifactName: manifest.artifactName,
    sha256: manifest.sha256,
    sizeBytes: manifest.sizeBytes
  };
}

function findUnsafeGeneratedContent(value) {
  const codes = new Set();
  const rawText = JSON.stringify(value);

  if (/[A-Za-z]:\\/.test(rawText) || /(^|["'\s])\/(?:Users|home|tmp|var)\//i.test(rawText)) {
    codes.add("privacy_local_path_leak");
  }

  visitValue(value, [], (path, entry) => {
    if (typeof entry !== "string") {
      return;
    }

    const joinedPath = path.join(".").toLowerCase();
    const allowedPrivacyEnum = joinedPath.startsWith("manifest.privacyredaction.") && entry === "forbidden";

    if (allowedPrivacyEnum) {
      return;
    }

    if (/[A-Za-z]:\\/.test(entry) || /(^|\s)\/(?:Users|home|tmp|var)\//i.test(entry)) {
      codes.add("privacy_local_path_leak");
    }

    if (/(?:authorization|api[_-]?key|token|cookie|private key|pfx|p12|password|pin|do_not_leak)/i.test(`${joinedPath} ${entry}`)) {
      codes.add("privacy_secret_leak");
    }

    if (/(?:secret_prompt_text|system prompt|full prompt|prompt text)/i.test(entry)) {
      codes.add("privacy_model_input_leak");
    }

    if (/(?:request_body|request body|raw request)/i.test(`${joinedPath} ${entry}`)) {
      codes.add("privacy_request_payload_leak");
    }

    if (/(?:user_message_text|assistant_message_text|conversation text|conversation body|user message|assistant message)/i.test(`${joinedPath} ${entry}`)) {
      codes.add("privacy_conversation_body_leak");
    }

    if (/(?:fact_card_text|fact-card|fact card body|user memory body)/i.test(`${joinedPath} ${entry}`)) {
      codes.add("privacy_fact_body_leak");
    }
  });

  return Array.from(codes);
}

function visitValue(value, path, visit) {
  visit(path, value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitValue(entry, [...path, String(index)], visit));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      visitValue(entry, [...path, key], visit);
    }
  }
}

async function fileIntegrity(filePath) {
  const stat = statSync(filePath);

  return {
    sha256: await sha256File(filePath),
    sizeBytes: stat.size
  };
}

function sha256File(filePath) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function resolveArtifactName(value, version) {
  const explicitName = readNonEmptyString(value);
  const artifactName = explicitName ?? `${DEFAULT_APP_NAME}-Setup-${version}-${DEFAULT_ARCH}.fixture.exe`;

  assertSafeBasename(artifactName, "p2_20r_artifact_name_not_basename");

  if (!/\.exe$/i.test(artifactName)) {
    throw new Error("p2_20r_artifact_name_not_windows_exe");
  }

  return artifactName;
}

function assertSafeBasename(value, reason) {
  if (!isBasenameOnly(value) || value.includes("\0")) {
    throw new Error(reason);
  }
}

function assertSafeTmpRoot(candidateRoot, repoRoot = getRepoRoot(), reason = "p2_20r_root_outside_repo_tmp") {
  const tmpRoot = resolve(repoRoot, ".tmp");
  const resolvedRoot = resolve(candidateRoot);
  const tmpPrefix = tmpRoot.endsWith(sep) ? tmpRoot : `${tmpRoot}${sep}`;

  if (resolvedRoot === tmpRoot || !resolvedRoot.startsWith(tmpPrefix)) {
    throw new Error(reason);
  }
}

function cleanupRunTargets(targets, repoRoot) {
  const uniqueTargets = Array.from(new Set(targets.map((target) => resolve(target))))
    .sort((left, right) => right.length - left.length);

  for (const target of uniqueTargets) {
    assertSafeTmpRoot(target, repoRoot, "p2_20r_cleanup_target_outside_repo_tmp");
    rmSync(target, { recursive: true, force: true });
  }
}

function readGitCommitShort(repoRoot) {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    return null;
  }

  return readSafeIdentifier(result.stdout.trim());
}

function isExistingFile(path) {
  try {
    return path.length > 0 && existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readSafeIdentifier(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_./:@+-]+$/i.test(text) ? text : null;
}

function readSafePublicText(value) {
  const text = readNonEmptyString(value);

  if (!text || /[A-Za-z]:\\/.test(text) || /(?:authorization|api[_-]?key|token|prompt|request body|user message|assistant message|fact-card)/i.test(text)) {
    return null;
  }

  return /^[a-z0-9_ ./:@+-]+$/i.test(text) ? text : null;
}

function readSafeStatus(value) {
  const text = readNonEmptyString(value);
  return text && /^[a-z0-9_-]+$/i.test(text) ? text : null;
}

function readBasenameOnly(value) {
  const text = readNonEmptyString(value);
  return text && isBasenameOnly(text) ? text : null;
}

function readIsoDate(value) {
  const text = readNonEmptyString(value);

  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function readPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function readPublicHttpsUrl(value) {
  const text = readNonEmptyString(value);

  if (!text) {
    return null;
  }

  try {
    const url = new URL(text);

    if (url.protocol !== "https:" || url.username || url.password || /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/i.test(url.hostname)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function isBasenameOnly(value) {
  const text = readNonEmptyString(value);
  return Boolean(text) && basename(text) === text && !/[\\/]/.test(text) && !/[A-Za-z]:/.test(text);
}

function normalizeSlashes(value) {
  return String(value).replace(/\\/g, "/");
}

function uniqueIssueCodes(codes) {
  return Array.from(new Set(codes.filter(Boolean))).sort();
}

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => typeof entryValue !== "undefined")
      .map(([key, entryValue]) => [key, removeUndefined(entryValue)])
  );
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(removeUndefined(value), null, 2)}\n`);
}

function parseCliOptions(argv) {
  const artifactArg = argv.find((arg) => arg.startsWith("--artifact="));
  const artifactIndex = argv.indexOf("--artifact");
  const outputArg = argv.find((arg) => arg.startsWith("--output-root="));
  const outputIndex = argv.indexOf("--output-root");
  const workArg = argv.find((arg) => arg.startsWith("--work-root="));
  const workIndex = argv.indexOf("--work-root");
  const versionArg = argv.find((arg) => arg.startsWith("--version="));

  return removeUndefined({
    artifactPath: artifactArg
      ? artifactArg.slice("--artifact=".length)
      : artifactIndex >= 0
        ? argv[artifactIndex + 1]
        : undefined,
    outputRoot: outputArg
      ? outputArg.slice("--output-root=".length)
      : outputIndex >= 0
        ? argv[outputIndex + 1]
        : undefined,
    workRoot: workArg
      ? workArg.slice("--work-root=".length)
      : workIndex >= 0
        ? argv[workIndex + 1]
        : undefined,
    version: versionArg ? versionArg.slice("--version=".length) : undefined,
    keepTmp: argv.includes("--keep-tmp"),
    fakeReadyEvidence: argv.includes("--fake-ready-evidence")
  });
}

function classifyScriptError(error) {
  if (error instanceof Error && /^p2_20r_[a-z0-9_]+$/.test(error.message)) {
    return error.message;
  }

  return error instanceof Error ? error.name : "unexpected_error";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  generateProductionReleaseManifest(parseCliOptions(process.argv.slice(2)))
    .then((result) => printJson(result.summary))
    .catch((error) => {
      printJson({
        ok: false,
        status: "script_failed",
        phase: PHASE,
        generator: GENERATOR_NAME,
        safeSummaryOnly: true,
        exitPolicy: "always_zero",
        reason: classifyScriptError(error)
      });
    });
}
