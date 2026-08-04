import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronPath = join(repoRoot, "node_modules", "electron", "dist", "electron.exe");
const probePath = join(repoRoot, "scripts", "p2-91b-windows-closed-probe.mjs");
const prefix = "P2_91B_CLOSED_PROBE ";

function execFileText(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, encoding: "utf8" }, (_error, stdout) => {
      resolve(String(stdout));
    });
  });
}

async function terminateOwnedProcessTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  await execFileText("taskkill.exe", ["/PID", String(pid), "/T", "/F"]);
}

async function hasOwnedProcessResidue(pid) {
  const output = await execFileText("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
  return new RegExp(`"[^\"]+","${pid}"`, "u").test(output);
}

async function hasAcceptancePortResidue() {
  const output = await execFileText("netstat.exe", ["-ano", "-p", "tcp"]);
  return /^\s*TCP\s+\S+:(?:9750|9751)\s+\S+\s+LISTENING\s+\d+\s*$/imu.test(output);
}

async function runClosedProbe() {
  const appDirectory = await mkdtemp(join(tmpdir(), "p2-91b-closed-probe-"));
  let child;
  let childPid = 0;
  await writeFile(
    join(appDirectory, "main.cjs"),
    `import(${JSON.stringify(pathToFileURL(probePath).href)}).catch(() => process.exit(1));\n`,
    "utf8"
  );
  await writeFile(join(appDirectory, "package.json"), JSON.stringify({
    name: "p2-91b-closed-probe",
    private: true,
    main: "main.cjs"
  }), "utf8");

  try {
    const report = await new Promise((resolve, reject) => {
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      child = spawn(electronPath, [appDirectory], {
        cwd: repoRoot,
        env: environment,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      childPid = child.pid ?? 0;
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      const timer = setTimeout(() => {
        timedOut = true;
        void terminateOwnedProcessTree(childPid).then(() => child?.kill());
      }, 15_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`P2-91B closed Windows probe failed: ${error.code ?? "spawn_failed"}`));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        const line = stdout.split(/\r?\n/u).find((entry) => entry.startsWith(prefix));
        if (timedOut || code !== 0 || !line) {
          reject(new Error(`P2-91B closed Windows probe failed: ${timedOut ? "timeout" : code ?? "no_output"}; ${stderr.trim()}`));
          return;
        }
        try {
          resolve(JSON.parse(line.slice(prefix.length)));
        } catch {
          reject(new Error("P2-91B closed Windows probe returned invalid JSON"));
        }
      });
    });
    return report;
  } finally {
    if (child?.exitCode === null) {
      await terminateOwnedProcessTree(childPid);
      child.kill();
    }
    await rm(appDirectory, { recursive: true, force: true });
    assert.equal(await hasOwnedProcessResidue(childPid), false);
    assert.equal(await hasAcceptancePortResidue(), false);
    assert.equal(existsSync(appDirectory), false);
  }
}

const report = await runClosedProbe();
assert.deepEqual(Object.keys(report), ["ok", "platform", "timeBand", "idleBucket", "quns", "gsmtc"]);
assert.equal(report.ok, true);
assert.equal(report.platform, "win32");
assert.match(report.timeBand, /^(?:morning|daytime|evening|night)$/u);
assert.match(report.idleBucket, /^(?:active|idle-short|idle-long|away)$/u);
for (const key of ["quns", "gsmtc"]) {
  assert.deepEqual(Object.keys(report[key]), ["status", "value", "capability"]);
}
const serialized = JSON.stringify(report);
assert.doesNotMatch(serialized, /title|artist|album|sourceAppId|window|process|path|requestId|raw|timestamp/iu);

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidence: {
    timeBand: report.timeBand,
    idleBucket: report.idleBucket,
    qunsStatus: report.quns.status,
    qunsValue: report.quns.value,
    gsmtcStatus: report.gsmtc.status,
    gsmtcValue: report.gsmtc.value,
    forbiddenFieldsAbsent: true,
    injectionUsed: false
  }
})}\n`);
