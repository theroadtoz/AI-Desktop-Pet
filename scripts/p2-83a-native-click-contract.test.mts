import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createWindowsNativeClickArgs,
  isExpectedNativePointTarget
} from "./support/p2-83a-native-click-contract.mjs";
import {
  isSameOwnedProcessIdentity,
  isTaskkillFailureIdempotent,
  parseOwnedProcessIdentities,
  selectInitialOwnedRootIdentity,
  summarizeOwnedProcessSurvivors
} from "./support/p2-83a-owned-process-identity.mjs";

test("native click arguments preserve client coordinates and per-monitor scale", () => {
  assert.deepEqual(createWindowsNativeClickArgs({
    expectedHwnd: "123456",
    expectedPid: 4321,
    clientX: 17.25,
    clientY: 33.5,
    deviceScaleFactor: 1.5
  }), [
    "-ExpectedHwnd", "123456",
    "-ExpectedPid", "4321",
    "-ClientX", "17.25",
    "-ClientY", "33.5",
    "-DeviceScaleFactor", "1.5"
  ]);
});

test("native click arguments reject missing ownership and unsafe coordinates", () => {
  assert.throws(() => createWindowsNativeClickArgs({
    expectedHwnd: "0x123",
    expectedPid: 0,
    clientX: -1,
    clientY: 0,
    deviceScaleFactor: 1
  }), /invalid_native_click_target/);
});

test("Chromium child HWND is accepted only when its root HWND and root PID match", () => {
  const childTarget = {
    targetHwnd: "220",
    targetRootHwnd: "100",
    expectedHwnd: "100",
    targetRootPid: 4321,
    expectedPid: 4321
  };
  assert.equal(isExpectedNativePointTarget(childTarget), true);
  assert.equal(isExpectedNativePointTarget({ ...childTarget, targetRootHwnd: "101" }), false);
  assert.equal(isExpectedNativePointTarget({ ...childTarget, targetRootPid: 4322 }), false);
});

test("native click C# Add-Type compiles before an invalid HWND fails closed", () => {
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "scripts/p2-83a-sendinput-click.ps1",
    "-ExpectedHwnd", "1",
    "-ExpectedPid", String(process.pid),
    "-ClientX", "0",
    "-ClientY", "0",
    "-DeviceScaleFactor", "1",
    "-PollIntervalMilliseconds", "10",
    "-ActivationTimeoutMilliseconds", "50",
    "-OutsideSettleMilliseconds", "0"
  ], {
    cwd: process.cwd(),
    windowsHide: true,
    encoding: "utf8",
    timeout: 15_000
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /safe_failure:/);
  assert.match(result.stderr, /Expected HWND is no longer valid/);
  assert.doesNotMatch(result.stderr, /Add-Type|compiler error|CS\d{4}/i);
  assert.doesNotMatch(result.stdout, /"ok"\s*:\s*true/i);
});

test("prepare-only and dispatch modes retain the same HWND and PID gates", () => {
  const source = readFileSync("scripts/p2-83a-sendinput-click.ps1", "utf8");
  assert.match(source, /\[switch\]\$PrepareOnly/);
  assert.match(source, /\[switch\]\$KeepCursorAtTarget/);
  assert.doesNotMatch(source, /CursorAlreadyPrepared|cursorAlreadyPrepared/);
  assert.match(source, /AssertProcess\(expectedHwnd, expectedPid, "expected HWND"\)/);
  assert.match(source, /AssertPointTarget\(clientPoint, expectedHwnd, expectedPid, "before SendInput"\)/);
  assert.match(source, /var targetRoot = GetAncestor\(target, GA_ROOT\)/);
  assert.match(source, /GetWindowThreadProcessId\(targetRoot, out actualPid\)/);
  assert.doesNotMatch(source, /GetWindowThreadProcessId\(target, out actualPid\)/);
  assert.match(source, /if \(prepareOnly\) return clientPoint\.x/);
  const sendInputIndex = source.indexOf("var sent = SendInput");
  const targetMoveIndex = source.indexOf("SetCursorPos(clientPoint.x, clientPoint.y)");
  assert.ok(targetMoveIndex >= 0 && sendInputIndex > targetMoveIndex);
});

test("owned process identity rejects PID reuse with a different creation time", () => {
  const oldIdentity = { pid: 4321, creationTimeUtcTicks: "638900000000000000", role: "root" };
  assert.equal(isSameOwnedProcessIdentity(oldIdentity, { ...oldIdentity }), true);
  assert.equal(isSameOwnedProcessIdentity(oldIdentity, {
    pid: 4321,
    creationTimeUtcTicks: "638900000000000001"
  }), false);
  assert.equal(isTaskkillFailureIdempotent(oldIdentity, [{
    ...oldIdentity,
    creationTimeUtcTicks: "638900000000000001"
  }]), true);
  assert.equal(isTaskkillFailureIdempotent(oldIdentity, [{ ...oldIdentity }]), false);
  assert.deepEqual(summarizeOwnedProcessSurvivors([
    oldIdentity,
    { pid: 4322, creationTimeUtcTicks: "638900000000000001", role: "descendant" }
  ]), { survivorCount: 2, rootAlive: true, descendantAliveCount: 1 });
  assert.throws(() => parseOwnedProcessIdentities([{ pid: 4321, creationTimeUtcTicks: "1", role: "other" }]),
    /invalid_owned_process_identity/);
});

test("initial root selector fixes the creation identity from an ownership-validated snapshot", () => {
  const currentRoot = { pid: 4321, creationTimeUtcTicks: "638900000100000001", role: "root" };
  assert.deepEqual(selectInitialOwnedRootIdentity({
    pid: 4321,
    identities: [currentRoot]
  }), currentRoot);
  assert.equal(selectInitialOwnedRootIdentity({ pid: 4322, identities: [currentRoot] }), null);
});

test("capture and wait subprocesses distinguish live, exited, and PID-reused identities", () => {
  const missingPid = "2147483646";
  const captureMissing = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "scripts/p2-83a-capture-process-tree.ps1",
    "-RootPid", missingPid,
    "-ExpectedParentPid", String(process.pid),
    "-ExpectedRootName", "electron.exe"
  ], { cwd: process.cwd(), windowsHide: true, encoding: "utf8", timeout: 15_000 });
  assert.equal(captureMissing.status, 0);
  assert.deepEqual(JSON.parse(captureMissing.stdout), []);

  const currentCreation = spawnSync("powershell.exe", [
    "-NoProfile", "-Command",
    `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${process.pid}'; ([DateTime]$p.CreationDate).ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)`
  ], { cwd: process.cwd(), windowsHide: true, encoding: "utf8", timeout: 15_000 });
  assert.equal(currentCreation.status, 0, currentCreation.stderr);
  const rootIdentity = {
    pid: process.pid,
    creationTimeUtcTicks: currentCreation.stdout.trim(),
    role: "root" as const
  };
  parseOwnedProcessIdentities([rootIdentity]);

  const tempDir = mkdtempSync(join(tmpdir(), "p2-83a-identity-"));
  try {
    const liveFile = join(tempDir, "live.json");
    const reusedFile = join(tempDir, "reused.json");
    const missingFile = join(tempDir, "missing.json");
    const staleParentSnapshotFile = join(tempDir, "stale-parent-snapshot.json");
    const reusedParentSnapshotFile = join(tempDir, "reused-parent-snapshot.json");
    const reusedNameSnapshotFile = join(tempDir, "reused-name-snapshot.json");
    const overLimitSnapshotFile = join(tempDir, "over-limit-snapshot.json");
    writeFileSync(liveFile, JSON.stringify([rootIdentity]), "utf8");
    writeFileSync(reusedFile, JSON.stringify([{
      ...rootIdentity,
      creationTimeUtcTicks: (BigInt(rootIdentity.creationTimeUtcTicks) + 1n).toString()
    }]), "utf8");
    writeFileSync(missingFile, JSON.stringify([{
      pid: Number(missingPid),
      creationTimeUtcTicks: "1",
      role: "descendant"
    }]), "utf8");
    writeFileSync(staleParentSnapshotFile, JSON.stringify([
      { ProcessId: 224, ParentProcessId: 4, Name: "electron.exe", CreationDate: "2026-07-20T10:00:00Z" },
      { ProcessId: 225, ParentProcessId: 224, Name: "electron.exe", CreationDate: "2026-07-20T10:00:01Z" },
      { ProcessId: 226, ParentProcessId: 224, Name: "electron.exe", CreationDate: "2026-07-20T09:59:59Z" },
      { ProcessId: 227, ParentProcessId: 224, Name: "notepad.exe", CreationDate: "2026-07-20T10:00:02Z" },
      { ProcessId: 228, ParentProcessId: 225, Name: "crashpad_handler.exe", CreationDate: "2026-07-20T10:00:03Z" },
      { ProcessId: 229, ParentProcessId: 226, Name: "electron.exe", CreationDate: "2026-07-20T10:00:04Z" }
    ]), "utf8");
    writeFileSync(reusedParentSnapshotFile, JSON.stringify([
      { ProcessId: 224, ParentProcessId: 99, Name: "electron.exe", CreationDate: "2026-07-20T10:00:00Z" },
      { ProcessId: 225, ParentProcessId: 224, Name: "electron.exe", CreationDate: "2026-07-20T10:00:01Z" }
    ]), "utf8");
    writeFileSync(reusedNameSnapshotFile, JSON.stringify([
      { ProcessId: 224, ParentProcessId: 4, Name: "notepad.exe", CreationDate: "2026-07-20T10:00:00Z" },
      { ProcessId: 225, ParentProcessId: 224, Name: "notepad.exe", CreationDate: "2026-07-20T10:00:01Z" }
    ]), "utf8");
    writeFileSync(overLimitSnapshotFile, JSON.stringify([
      { ProcessId: 224, ParentProcessId: 4, Name: "electron.exe", CreationDate: "2026-07-20T10:00:00Z" },
      ...Array.from({ length: 32 }, (_, index) => ({
        ProcessId: 300 + index,
        ParentProcessId: 224,
        Name: "electron.exe",
        CreationDate: "2026-07-20T10:00:01Z"
      }))
    ]), "utf8");

    const captureSnapshot = (snapshotFile: string) => spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "scripts/p2-83a-capture-process-tree.ps1",
      "-RootPid", "224",
      "-ExpectedParentPid", "4",
      "-ExpectedRootName", "electron.exe",
      "-SnapshotFile", snapshotFile
    ], { cwd: process.cwd(), windowsHide: true, encoding: "utf8", timeout: 15_000 });
    const staleParentCapture = captureSnapshot(staleParentSnapshotFile);
    assert.equal(staleParentCapture.status, 0, staleParentCapture.stderr);
    assert.deepEqual(
      parseOwnedProcessIdentities(JSON.parse(staleParentCapture.stdout)).map(({ pid, role }) => ({ pid, role })),
      [
        { pid: 224, role: "root" },
        { pid: 225, role: "descendant" },
        { pid: 228, role: "descendant" }
      ]
    );
    for (const reusedSnapshotFile of [reusedParentSnapshotFile, reusedNameSnapshotFile]) {
      const reusedBeforeCapture = captureSnapshot(reusedSnapshotFile);
      assert.notEqual(reusedBeforeCapture.status, 0);
      assert.deepEqual(JSON.parse(reusedBeforeCapture.stdout), []);
      assert.match(reusedBeforeCapture.stderr, /safe_failure:/);
      assert.match(reusedBeforeCapture.stderr, /ownership does not match/);
    }
    const overLimitCapture = captureSnapshot(overLimitSnapshotFile);
    assert.notEqual(overLimitCapture.status, 0);
    assert.match(overLimitCapture.stderr, /safe_failure:/);
    assert.match(overLimitCapture.stderr, /identity limit exceeded/);
    assert.equal(overLimitCapture.stdout.trim(), "");

    const runProbe = (identityFile: string) => spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "scripts/p2-83a-probe-owned-process-identities.ps1",
      "-IdentityFile", identityFile
    ], { cwd: process.cwd(), windowsHide: true, encoding: "utf8", timeout: 15_000 });
    const liveProbe = runProbe(liveFile);
    assert.equal(liveProbe.status, 0, liveProbe.stderr);
    assert.deepEqual(parseOwnedProcessIdentities(JSON.parse(liveProbe.stdout)), [rootIdentity]);
    const reusedProbe = runProbe(reusedFile);
    assert.equal(reusedProbe.status, 0, reusedProbe.stderr);
    assert.deepEqual(JSON.parse(reusedProbe.stdout), []);

    const runWait = (identityFile: string) => spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "scripts/p2-83a-wait-owned-exit.ps1",
      "-IdentityFile", identityFile,
      "-TimeoutMilliseconds", "100"
    ], { cwd: process.cwd(), windowsHide: true, encoding: "utf8", timeout: 15_000 });
    const liveWait = runWait(liveFile);
    assert.notEqual(liveWait.status, 0);
    assert.deepEqual(JSON.parse(liveWait.stderr), {
      survivorCount: 1,
      rootAlive: true,
      descendantAliveCount: 0
    });
    const reusedWait = runWait(reusedFile);
    assert.equal(reusedWait.status, 0, reusedWait.stderr);
    const missingWait = runWait(missingFile);
    assert.equal(missingWait.status, 0, missingWait.stderr);

    const waitHwnd = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "scripts/p2-83a-wait-hwnd-invalid.ps1",
      "-ExpectedHwnd", "0",
      "-IdentityFile", liveFile,
      "-TimeoutMilliseconds", "200"
    ], { cwd: process.cwd(), windowsHide: true, encoding: "utf8", timeout: 15_000 });
    assert.equal(waitHwnd.status, 0);
    assert.doesNotMatch(waitHwnd.stderr, /Add-Type|compiler error|CS\d{4}/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
