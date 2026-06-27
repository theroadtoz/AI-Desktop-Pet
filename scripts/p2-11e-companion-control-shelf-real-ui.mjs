import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runParentDir = join(root, ".tmp", "p2-11e-companion-control-shelf-real-ui");
const runDir = join(runParentDir, stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const progressPath = join(runDir, "progress.log");
const port = Number(process.env.P2_11E_CDP_PORT || 9534);
const forbiddenTexts = [
  "sk-",
  "provider request body",
  "system prompt",
  "完整 prompt",
  ".env.local",
  "原始鼠标轨迹"
];

mkdirSync(runDir, { recursive: true });

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  writeFileSync(progressPath, `${line}\n`, { flag: "a" });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return response.json();
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      await sleep(300);
    }
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.webSocketUrl);
    this.socket.addEventListener("message", (event) => this.onMessage(event));
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener("open", resolveOpen, { once: true });
      this.socket.addEventListener("error", rejectOpen, { once: true });
    });
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (!message.id) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.resolve(message.result ?? {});
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));

    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
      setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        rejectSend(new Error(`CDP timeout: ${method}`));
      }, 15_000).unref();
    });
  }

  close() {
    this.socket?.close();
  }
}

async function connectTarget(partialUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, 10_000);
    const target = targets.find((entry) => entry.type === "page" && entry.url.includes(partialUrl));
    if (target) {
      const cdp = new CdpClient(target.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      return { target, cdp };
    }
    await sleep(300);
  }
  throw new Error(`Target not found: ${partialUrl}`);
}

async function evaluate(cdp, expression, awaitPromise = true) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed";
    throw new Error(detail);
  }

  return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(cdp, expression);
    if (value) {
      return value;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

function launchElectron() {
  const electronExe = join(root, "node_modules", "electron", "dist", "electron.exe");
  const electronCmd = existsSync(electronExe) ? electronExe : join(root, "node_modules", ".bin", "electron.cmd");
  const child = spawn(electronCmd, [".", `--remote-debugging-port=${port}`], {
    cwd: root,
    env: {
      ...process.env,
      APPDATA: appDataDir,
      AI_DESKTOP_PET_USER_DATA_PATH: appDataDir,
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_API_KEY: "",
      AI_DESKTOP_PET_BASE_URL: "",
      AI_DESKTOP_PET_MODEL: "",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1"
    },
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeFileSync(join(runDir, "electron.stdout.log"), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(join(runDir, "electron.stderr.log"), chunk, { flag: "a" }));
  writeFileSync(join(runDir, "electron.pid"), String(child.pid ?? ""));
  return child;
}

async function openChat() {
  await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
  const pet = await connectTarget("renderer/pet/index.html");
  await sleep(800);
  await evaluate(pet.cdp, "window.petApi?.openChat()");
  const chat = await connectTarget("renderer/chat/index.html");
  await waitFor(chat.cdp, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");
  return { pet, chat };
}

async function stopElectron(child, handles) {
  handles?.pet?.cdp.close();
  handles?.chat?.cdp.close();
  child?.kill();
  await sleep(1_000);
}

async function click(cdp, selector) {
  await evaluate(cdp, `
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error(${JSON.stringify(`Missing selector: ${selector}`)});
      element.click();
    })()
  `);
  await sleep(250);
}

async function saveWelcomeProfile(cdp) {
  await evaluate(cdp, `
    (() => {
      document.querySelector("#welcome-user-display-name").value = "P2-11E 验收用户";
      document.querySelector("#welcome-user-preferred-name").value = "馆长";
      document.querySelector("#welcome-save-user-profile-button").click();
    })()
  `);
  await waitFor(cdp, "document.querySelector('#user-welcome-panel')?.hidden === true");
}

async function setMode(cdp, modeId) {
  await click(cdp, `.mode-button[data-mode-id="${modeId}"]`);
  await waitFor(cdp, `document.querySelector('#dialogue-mode-controls .mode-button.is-active')?.dataset.modeId === ${JSON.stringify(modeId)}`);
}

async function setViewport(cdp, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await sleep(300);
}

async function checkLayout(cdp, width, height) {
  await setViewport(cdp, width, height);
  const result = await evaluate(cdp, `
    (() => {
      const visible = (node) => {
        if (!node || node.hidden || node.closest("[hidden]")) return false;
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      };
      const selectors = [
        ".chat-shell",
        ".partner-status-band",
        "#companion-control-shelf",
        "#dialogue-mode-controls",
        "#chat-session-note",
        "#messages",
        "#chat-form"
      ];
      const overflowing = [];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!visible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < -1 || rect.right > window.innerWidth + 1 || rect.width <= 0 || rect.height <= 0) {
          overflowing.push(selector);
        }
      }
      const controls = [...document.querySelectorAll("#companion-control-shelf button, #chat-form button, #chat-form input")]
        .filter(visible)
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left < -1 || rect.right > window.innerWidth + 1 || rect.height <= 0;
        })
        .map((node) => node.id || node.textContent);
      return { ok: overflowing.length === 0 && controls.length === 0, overflowing, controls };
    })()
  `);
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await sleep(150);
  return result;
}

function readTextFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const texts = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      texts.push(...readTextFiles(fullPath));
      continue;
    }
    if (/\.(json|jsonl|log)$/i.test(entry.name)) {
      texts.push(readFileSync(fullPath, "utf8"));
    }
  }
  return texts;
}

function readPrivacyCheckText() {
  const texts = readTextFiles(join(appDataDir, "logs"));
  for (const fileName of ["progress.log", "electron.stdout.log", "electron.stderr.log", "result.json"]) {
    const filePath = join(runDir, fileName);
    if (existsSync(filePath)) {
      texts.push(readFileSync(filePath, "utf8"));
    }
  }
  return texts.join("\n");
}

function findResidue(directory) {
  const ignored = new Set([".git", "node_modules", "dist"]);
  const matches = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (/^p2-11e-/.test(entry.name) && fullPath.includes(`${join(root, ".tmp")}`)) {
        matches.push(fullPath);
      } else {
        matches.push(...findResidue(fullPath));
      }
      continue;
    }

    if (/^(screenshot.*|screen|p2-11e-.*)\.png$/i.test(entry.name)) {
      matches.push(fullPath);
    }
  }

  return matches;
}

async function runFirstSession(checks) {
  const child = launchElectron();
  let handles = {};

  try {
    handles = await openChat();
    const chat = handles.chat.cdp;
    const pet = handles.pet.cdp;

    checks.welcomeVisibleBeforeProfile = await evaluate(chat, "document.querySelector('#user-welcome-panel')?.hidden === false");
    await saveWelcomeProfile(chat);
    checks.shelfVisibleAfterProfile = await evaluate(chat, `
      (() => {
        const shelf = document.querySelector("#companion-control-shelf");
        return shelf?.hidden === false &&
          shelf.textContent.includes("模式") &&
          shelf.textContent.includes("配件：无配件") &&
          shelf.textContent.includes("大小：100%") &&
          shelf.textContent.includes("锁定：未锁定") &&
          shelf.textContent.includes("最近动作：等待中");
      })()
    `);

    await setMode(chat, "reading");
    checks.modeSyncsShelfAndRibbon = await evaluate(chat, `
      (() => document.querySelector("#partner-status")?.textContent.includes("读书模式") &&
        document.querySelector("#dialogue-mode-controls .mode-button.is-active")?.dataset.modeId === "reading")()
    `);

    await click(chat, "#shelf-accessory-button");
    await waitFor(chat, "document.querySelector('#shelf-accessory-button')?.textContent.includes('眼镜')");
    checks.accessoryToggleSyncsShelf = await evaluate(chat, `
      document.querySelector("#shelf-accessory-button")?.textContent.includes("眼镜")
    `);

    await click(chat, "#shelf-scale-button");
    await evaluate(chat, `
      (() => {
        const input = document.querySelector("#pet-scale");
        input.value = "1.10";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector("#save-pet-scale-button").click();
      })()
    `);
    await waitFor(chat, "document.querySelector('#shelf-scale-button')?.textContent.includes('110%')");
    checks.scaleSummaryUsesSettingsPath = await evaluate(chat, `
      document.querySelector("#pet-scale-value")?.textContent.includes("1.10") ||
        document.querySelector("#pet-scale-value")?.value.includes("1.10")
    `);
    await click(chat, "#settings-close-button");

    await click(chat, "#shelf-lock-button");
    await waitFor(chat, "document.querySelector('#shelf-lock-button')?.textContent.includes('已锁定')");
    checks.lockToggleSyncsShelf = await evaluate(chat, `
      document.querySelector("#shelf-lock-button")?.textContent.includes("已锁定")
    `);

    await click(chat, "#settings-button");
    checks.lockShortcutStillVisible = await evaluate(chat, `
      document.querySelector("#shortcut-list")?.textContent.includes("Tab+0")
    `);
    await click(chat, "#settings-close-button");

    await evaluate(pet, `
      (() => {
        window.petApi?.reportTelemetry("pet_interaction_action_started", {
          type: "headPat",
          reason: "p2_11e_acceptance",
          durationMs: 1
        });
      })()
    `);
    await waitFor(chat, "document.querySelector('#shelf-action-echo')?.textContent.includes('刚刚摸头')");
    checks.actionEchoIsShortAndVisible = await evaluate(chat, `
      (() => {
        const text = document.querySelector("#shelf-action-echo")?.textContent ?? "";
        return text.includes("刚刚摸头") &&
          !text.includes("p2_11e_acceptance") &&
          !text.includes("durationMs");
      })()
    `);

    await evaluate(pet, `
      (() => {
        window.petApi?.reportTelemetry("pet_window_motion_feedback", {
          eventType: "window_shake_candidate",
          reason: "window_shake_feedback",
          feedbackType: "shake_light_feedback",
          result: "started"
        });
      })()
    `);
    await waitFor(chat, "document.querySelector('#shelf-action-echo')?.textContent.includes('刚刚被晃了一下')");
    checks.windowMotionEchoIsShort = await evaluate(chat, `
      document.querySelector("#shelf-action-echo")?.textContent.includes("刚刚被晃了一下")
    `);

    const desktopLayout = await checkLayout(chat, 420, 640);
    const narrowLayout = await checkLayout(chat, 360, 720);
    checks.desktopLayout = desktopLayout.ok;
    checks.narrowLayout = narrowLayout.ok;
    return { desktopLayout, narrowLayout };
  } finally {
    await stopElectron(child, handles);
  }
}

async function runRestartSession(checks) {
  const child = launchElectron();
  let handles = {};

  try {
    handles = await openChat();
    const chat = handles.chat.cdp;
    await waitFor(chat, "document.querySelector('#user-welcome-panel')?.hidden === true");
    checks.accessoryRestoresAfterRestart = await evaluate(chat, `
      document.querySelector("#shelf-accessory-button")?.textContent.includes("眼镜")
    `);
    checks.scaleRestoresAfterRestart = await evaluate(chat, `
      document.querySelector("#shelf-scale-button")?.textContent.includes("110%")
    `);
    return await evaluate(chat, `
      (() => ({
        partnerStatus: document.querySelector("#partner-status")?.textContent ?? "",
        shelfText: document.querySelector("#companion-control-shelf")?.textContent ?? "",
        providerStatus: document.querySelector("#provider-status")?.textContent ?? "",
        memoryStatus: document.querySelector("#memory-session-status")?.textContent ?? ""
      }))()
    `);
  } finally {
    await stopElectron(child, handles);
  }
}

async function main() {
  log(`runDir=${runDir}`);
  log(`appDataDir=${appDataDir}`);

  const checks = {};
  const layout = await runFirstSession(checks);
  await sleep(800);
  const finalUi = await runRestartSession(checks);
  const textOutput = readPrivacyCheckText();
  checks.privacyOutput = forbiddenTexts.every((text) => !textOutput.includes(text));
  checks.noScreenshotResidueBeforeCleanup = findResidue(root).filter((path) => !path.includes(runParentDir)).length === 0;

  const result = {
    ok: Object.values(checks).every(Boolean),
    runDir,
    appDataDir,
    provider: "fake",
    port,
    checks,
    layout,
    finalUi,
    residue: findResidue(root)
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  log(`checks=${JSON.stringify(checks)}`);
  log(`finalUi=${JSON.stringify(finalUi)}`);
  log(`result=${JSON.stringify(result)}`);

  if (!result.ok) {
    throw new Error(`P2-11E real UI checks failed: ${JSON.stringify(checks)}`);
  }
}

main().catch((error) => {
  const result = {
    ok: false,
    runDir,
    appDataDir,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    residue: findResidue(root)
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.error(result.error);
  process.exitCode = 1;
}).finally(() => {
  if (process.env.P2_11E_KEEP_TMP !== "1") {
    rmSync(runParentDir, { recursive: true, force: true });
  }
});
