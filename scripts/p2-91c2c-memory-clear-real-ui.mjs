import {
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const context = createRealUiRunContext({
  runName: "p2-91c2c-memory-clear-real-ui",
  port: Number(process.env.P2_91C2C_CDP_PORT || 9802),
  env: { AI_DESKTOP_PET_P2_91C2C_UNTRUSTED_PRELOAD_FIXTURE: "1" }
});

const paths = {
  facts: join(context.appDataDir, "memory", "facts.json"),
  reviews: join(context.appDataDir, "memory", "reviews.json"),
  profile: join(context.appDataDir, "config", "user-profile.json"),
  transaction: join(context.appDataDir, "memory", "memory-clear-transaction")
};
const now = Date.now();
const ids = {
  card: "11111111-1111-4111-8111-111111111111",
  conversation: "22222222-2222-4222-8222-222222222222",
  pending: "33333333-3333-4333-8333-333333333333",
  confirmed: "44444444-4444-4444-8444-444444444444",
  rejected: "55555555-5555-4555-8555-555555555555",
  blocked: "66666666-6666-4666-8666-666666666666"
};

let result = { ok: false, checks: {} };
let step = "seed";
try {
  seedLegalFixture();
  rmSync(paths.profile, { force: true });
  step = "first-open";
  const first = await openApp();
  writeLegacyProfile();
  const beforeUnauthorized = snapshotParticipants();
  step = "pet-boundary";
  const petUnauthorized = await invokeMemoryClearFromUntrustedPreload(first.untrustedPet);
  step = "child-boundary";
  const childUnauthorized = await invokeMemoryClearFromUntrustedPreload(first.untrustedChild);
  step = "foreign-boundary";
  const foreignUnauthorized = await invokeMemoryClearFromUntrustedPreload(first.untrustedForeign);
  const unauthorizedZeroChange = sameParticipants(beforeUnauthorized, snapshotParticipants());
  step = "bundled-clear";
  const bundledPreloadClear = await evaluate(first.chat, `
    (async () => {
      if (typeof window.memoryApi?.clearCards !== 'function') return false;
      await window.memoryApi.clearCards();
      return true;
    })()
  `);
  await stopElectron(context);

  const diskAfterClear = readClearedDisk();
  step = "restart-open";
  const second = await openApp();
  step = "restart-readback";
  const restartReadback = await evaluate(second.chat, `
    Promise.all([
      window.memoryApi.listCards(),
      window.memoryApi.listReviews(),
      window.userProfileApi.getUserProfile()
    ]).then(([cards, reviews, profile]) => ({
      cardsEmpty: cards.length === 0,
      pendingRemoved: reviews.every((candidate) => candidate.status !== 'pending-review'),
      preservedStatuses: ['confirmed', 'rejected', 'blocked'].every((status) => reviews.some((candidate) => candidate.status === status)),
      profileRemoved: profile === null
    }))
  `);
  await stopElectron(context);

  step = "recovery-required-seed";
  seedLegalFixture();
  rmSync(paths.profile, { force: true });
  context.env.AI_DESKTOP_PET_P2_91C2C_RECOVERY_REQUIRED_FIXTURE = "1";
  const recoverySeedApp = await openApp();
  writeLegacyProfile();
  const recoverySeedFailure = await evaluate(recoverySeedApp.chat, `
    window.memoryApi.clearCards().then(
      () => false,
      (error) => String(error?.message ?? '').includes('Memory clear failed')
    )
  `);
  const currentProcessRecoveryMode = await verifyRecoveryMode(recoverySeedApp.chat);
  const recoveryRequiredParticipants = snapshotParticipants();
  const recoveryRequiredArtifacts = snapshotTransactionArtifacts();
  await stopElectron(context);

  step = "startup-recovery-required";
  delete context.env.AI_DESKTOP_PET_P2_91C2C_RECOVERY_REQUIRED_FIXTURE;
  const recoveryRestartApp = await openApp();
  const startupRecoveryRequiredFixedFailure = await verifyRecoveryMode(recoveryRestartApp.chat);
  await stopElectron(context);
  const startupRecoveryRequiredZeroChange = sameParticipants(recoveryRequiredParticipants, snapshotParticipants());
  const startupRecoveryRequiredResidueRetained = recoveryRequiredArtifacts !== null &&
    JSON.stringify(recoveryRequiredArtifacts) === JSON.stringify(snapshotTransactionArtifacts());
  const startupRecoveryRequired = recoverySeedFailure && currentProcessRecoveryMode &&
    startupRecoveryRequiredFixedFailure && startupRecoveryRequiredZeroChange && startupRecoveryRequiredResidueRetained;
  rmSync(paths.transaction, { recursive: true, force: true });

  const unsafeChecks = {};
  for (const unsafeCase of unsafeCases()) {
    step = `unsafe-${unsafeCase.name}-seed`;
    seedLegalFixture();
    rmSync(paths.profile, { force: true });
    unsafeCase.mutate();
    step = `unsafe-${unsafeCase.name}-open`;
    const app = await openApp();
    writeLegacyProfile(unsafeCase.preferredName);
    const before = snapshotParticipants();
    step = `unsafe-${unsafeCase.name}-clear`;
    const attempt = await evaluate(app.chat, `
      window.memoryApi.clearCards().then(
        () => ({ rejected: false, safe: false }),
        (error) => {
          const message = String(error?.message ?? '');
          return {
            rejected: true,
            safe: message.includes('Memory clear failed') &&
              !message.includes('sk-p2-91c2c-private') &&
              !message.includes(${JSON.stringify(context.appDataDir)})
          };
        }
      )
    `);
    await stopElectron(context);
    unsafeChecks[unsafeCase.name] = attempt.rejected && attempt.safe &&
      sameParticipants(before, snapshotParticipants()) && !existsSync(paths.transaction);
  }

  const checks = {
    bundledPreloadClear,
    petUnauthorized,
    childUnauthorized,
    foreignUnauthorized,
    unauthorizedChildAndForeignZeroChange: petUnauthorized && childUnauthorized && foreignUnauthorized && unauthorizedZeroChange,
    diskFactsClearedSuppressionsPreserved: diskAfterClear.facts,
    diskPendingOnlyCleared: diskAfterClear.reviews,
    diskLegacyProfileRemoved: diskAfterClear.profile,
    noSuccessfulResidue: diskAfterClear.noResidue,
    restartReadback: Object.values(restartReadback).every(Boolean),
    startupRecoveryRequired,
    startupRecoveryRequiredFixedFailure,
    startupRecoveryRequiredZeroChange,
    startupRecoveryRequiredResidueRetained,
    invalidZeroChange: unsafeChecks.invalid === true,
    futureZeroChange: unsafeChecks.future === true,
    sensitiveZeroChange: unsafeChecks.sensitive === true
  };
  result = {
    ok: Object.values(checks).every(Boolean),
    checks,
    screenshotResidue: findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir)).length
  };
  result.ok &&= result.screenshotResidue === 0;
} catch (error) {
  result = { ok: false, checks: {}, failure: { step, name: error instanceof Error ? error.name : "unknown" } };
} finally {
  await stopElectron(context);
  if (result.ok) cleanupRealUiRun(context);
}

console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;

async function openApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(window.memoryApi?.clearCards && window.userProfileApi?.getUserProfile)");
  const untrustedPet = await waitForWindow(context, "#p2-91c2c-untrusted-pet");
  const untrustedChild = await waitForWindow(context, "#p2-91c2c-untrusted-child");
  const untrustedForeign = await waitForWindow(context, "#p2-91c2c-untrusted-foreign");
  for (const untrusted of [untrustedPet, untrustedChild, untrustedForeign]) {
    await waitFor(untrusted, "Boolean(window.memoryApi?.clearCards)");
  }
  return { pet, chat, untrustedPet, untrustedChild, untrustedForeign };
}

async function invokeMemoryClearFromUntrustedPreload(page) {
  return evaluate(page, `
    window.memoryApi.clearCards().then(
      () => false,
      (error) => String(error?.message ?? '').includes('Unauthorized memory request')
    )
  `);
}

async function verifyRecoveryMode(page) {
  return evaluate(page, `
    Promise.all([
      window.memoryApi.clearCards().then(
        () => false,
        (error) => String(error?.message ?? '').includes('Memory clear failed')
      ),
      window.memoryApi.listCards().then(
        () => false,
        (error) => String(error?.message ?? '').includes('Unauthorized memory request')
      ),
      window.userProfileApi.getUserProfile().then(
        () => false,
        (error) => String(error?.message ?? '').includes('Unauthorized user profile request')
      )
    ]).then((checks) => checks.every(Boolean))
  `);
}

function seedLegalFixture() {
  rmSync(paths.transaction, { recursive: true, force: true });
  mkdirSync(join(context.appDataDir, "memory"), { recursive: true });
  mkdirSync(join(context.appDataDir, "config"), { recursive: true });
  const facts = {
    version: 4,
    enabled: true,
    cards: [{
      id: ids.card,
      title: "验收事实",
      content: "用户喜欢安静的陪伴",
      tags: ["验收"],
      sourceConversationId: ids.conversation,
      sourceType: "manual-chat",
      namespace: "personal",
      key: "acceptance-fact",
      importance: "key",
      category: "manual",
      confidence: 1,
      sourceMessageId: null,
      observedCount: 1,
      lastObservedAt: now,
      compressionState: "raw",
      createdAt: now,
      updatedAt: now,
      enabled: true,
      managedByUser: true,
      lastInjectedAt: null,
      injectionCount: 0
    }],
    suppressions: [{ namespace: "personal", key: "preferred-name", category: "addressing", createdAt: now }]
  };
  const reviews = {
    version: 1,
    candidates: [
      review(ids.pending, "pending-review"),
      review(ids.confirmed, "confirmed"),
      review(ids.rejected, "rejected"),
      review(ids.blocked, "blocked")
    ]
  };
  writeFileSync(paths.facts, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
  writeFileSync(paths.reviews, `${JSON.stringify(reviews, null, 2)}\n`, "utf8");
  writeLegacyProfile();
}

function writeLegacyProfile(preferredName = "验收称呼") {
  writeFileSync(paths.profile, `${JSON.stringify({
    displayName: "验收用户",
    preferredName,
    completedAt: new Date(now).toISOString()
  }, null, 2)}\n`, "utf8");
}

function review(id, status) {
  return {
    action: "create",
    title: `验收候选-${status}`,
    content: "用户喜欢安静的陪伴",
    tags: ["验收"],
    namespace: "personal",
    key: `acceptance-${status}`,
    importance: "general",
    category: "manual",
    confidence: 0.9,
    sourceConversationId: ids.conversation,
    sourceMessageId: ids.card,
    id,
    status,
    createdAt: now,
    updatedAt: now
  };
}

function snapshotParticipants() {
  return Object.fromEntries(Object.entries(paths).filter(([name]) => name !== "transaction").map(([name, path]) => {
    if (!existsSync(path)) return [name, { exists: false, bytes: null, mtimeNs: null }];
    return [name, {
      exists: true,
      bytes: readFileSync(path).toString("base64"),
      mtimeNs: statSync(path, { bigint: true }).mtimeNs.toString()
    }];
  }));
}

function sameParticipants(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function snapshotTransactionArtifacts() {
  if (!existsSync(paths.transaction)) return null;
  const files = {};
  const visit = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(path, relative);
      } else if (entry.isFile()) {
        files[relative] = {
          bytes: readFileSync(path).toString("base64"),
          mtimeNs: statSync(path, { bigint: true }).mtimeNs.toString()
        };
      } else {
        files[relative] = { unsupported: true };
      }
    }
  };
  visit(paths.transaction);
  return files;
}

function readClearedDisk() {
  const facts = JSON.parse(readFileSync(paths.facts, "utf8"));
  const reviews = JSON.parse(readFileSync(paths.reviews, "utf8"));
  return {
    facts: facts.enabled === true && facts.cards.length === 0 && facts.suppressions.length === 1 &&
      facts.suppressions[0].key === "preferred-name",
    reviews: reviews.candidates.length === 3 && reviews.candidates.every((candidate) => candidate.status !== "pending-review") &&
      ["confirmed", "rejected", "blocked"].every((status) => reviews.candidates.some((candidate) => candidate.status === status)),
    profile: !existsSync(paths.profile),
    noResidue: !existsSync(paths.transaction)
  };
}

function unsafeCases() {
  return [
    { name: "invalid", preferredName: "验收称呼", mutate: () => writeFileSync(paths.facts, "{", "utf8") },
    { name: "future", mutate: () => {
      const facts = JSON.parse(readFileSync(paths.facts, "utf8"));
      facts.version = 5;
      writeFileSync(paths.facts, `${JSON.stringify(facts)}\n`, "utf8");
    }, preferredName: "验收称呼" },
    { name: "sensitive", preferredName: "sk-p2-91c2c-private", mutate: () => {} }
  ];
}
