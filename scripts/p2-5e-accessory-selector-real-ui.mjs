import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", `p2-5e-accessory-selector-${stamp}`);
const appDataDir = join(runDir, "user-data");
const port = Number(process.env.P2_5E_CDP_PORT || 9355);

mkdirSync(appDataDir, { recursive: true });

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
      await sleep(500);
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
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const target = targets.find((entry) => entry.type === "page" && entry.url.includes(partialUrl));
    if (target) {
      const cdp = new CdpClient(target.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      return cdp;
    }
    await sleep(500);
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
    throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }

  return result.result?.value;
}

async function screenshotSignature(cdp) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  return {
    length: result.data.length,
    hash: createHash("sha256").update(result.data).digest("hex")
  };
}

function signatureChanged(a, b) {
  return a.length !== b.length || a.hash !== b.hash;
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
      AI_DESKTOP_PET_MODEL: ""
    },
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => writeFileSync(join(runDir, "electron.stdout.log"), chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(join(runDir, "electron.stderr.log"), chunk, { flag: "a" }));
  return child;
}

async function stopElectron(child) {
  child.kill();
  await sleep(1_000);
}

async function openChatFromPet(petCdp) {
  await evaluate(petCdp, "window.petApi?.openChat()");
  return connectTarget("renderer/chat/index.html");
}

async function setAccessoryFromSettings(chatCdp, presetId) {
  return evaluate(chatCdp, `
    (async () => {
      document.querySelector("#settings-button").click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const select = document.querySelector("#pet-accessory");
      if (!select) {
        throw new Error("pet accessory selector missing");
      }
      select.value = ${JSON.stringify(presetId)};
      select.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector("#save-pet-accessory-button").click();
      await new Promise((resolve) => setTimeout(resolve, 600));
      return {
        value: select.value,
        status: document.querySelector("#pet-accessory-status")?.textContent ?? "",
        feedback: document.querySelector("#settings-feedback")?.textContent ?? "",
        preferences: await window.petPresentationApi.getPreferences()
      };
    })()
  `);
}

async function clickPetAction(petCdp, randomValue) {
  await evaluate(petCdp, `Math.random = () => ${randomValue}`);
  await evaluate(petCdp, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 25,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        buttons: 1,
        bubbles: true
      }));
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: 25,
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        bubbles: true
      }));
    })()
  `);
  await sleep(260);
}

async function runSession(expectPersistedGlasses) {
  const child = launchElectron();
  let petCdp = null;
  let chatCdp = null;

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    petCdp = await connectTarget("renderer/pet/index.html");
    await sleep(3_000);
    chatCdp = await openChatFromPet(petCdp);
    await sleep(800);

    const initialPreferences = await evaluate(chatCdp, "window.petPresentationApi.getPreferences()");
    if (expectPersistedGlasses && initialPreferences.accessoryPresetId !== "glasses") {
      throw new Error(`Persisted accessory not restored: ${initialPreferences.accessoryPresetId}`);
    }

    const noneFrame = await screenshotSignature(petCdp);
    const glassesResult = await setAccessoryFromSettings(chatCdp, "glasses");
    if (glassesResult.preferences.accessoryPresetId !== "glasses" || !glassesResult.status.includes("眼镜")) {
      throw new Error("Glasses accessory was not saved from settings");
    }
    await sleep(1_000);
    const glassesFrame = await screenshotSignature(petCdp);

    await clickPetAction(petCdp, 0.92);
    await sleep(2_500);
    const afterReading = await evaluate(chatCdp, "window.petPresentationApi.getPreferences()");
    if (afterReading.accessoryPresetId !== "glasses") {
      throw new Error("Reading action overwrote persistent glasses");
    }

    await clickPetAction(petCdp, 0.8);
    await sleep(2_300);
    const afterPlayGame = await evaluate(chatCdp, "window.petPresentationApi.getPreferences()");
    if (afterPlayGame.accessoryPresetId !== "glasses") {
      throw new Error("PlayGame action overwrote persistent glasses");
    }

    const noneResult = await setAccessoryFromSettings(chatCdp, "none");
    if (noneResult.preferences.accessoryPresetId !== "none" || !noneResult.status.includes("无配件")) {
      throw new Error("None accessory was not saved from settings");
    }
    await sleep(1_000);
    const noneAgainFrame = await screenshotSignature(petCdp);

    return {
      ok: true,
      initialPreferences,
      glassesSaved: glassesResult.preferences,
      noneSaved: noneResult.preferences,
      visualChangedWhenGlassesApplied: signatureChanged(noneFrame, glassesFrame),
      visualChangedWhenGlassesRemoved: signatureChanged(glassesFrame, noneAgainFrame)
    };
  } finally {
    petCdp?.close();
    chatCdp?.close();
    await stopElectron(child);
  }
}

async function main() {
  let result;

  try {
    const first = await runSession(false);
    const child = launchElectron();
    let petCdp = null;
    let chatCdp = null;
    try {
      await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
      petCdp = await connectTarget("renderer/pet/index.html");
      await sleep(3_000);
      chatCdp = await openChatFromPet(petCdp);
      await setAccessoryFromSettings(chatCdp, "glasses");
    } finally {
      petCdp?.close();
      chatCdp?.close();
      await stopElectron(child);
    }
    const second = await runSession(true);
    result = { ok: true, first, second };

    if (!first.visualChangedWhenGlassesApplied || !first.visualChangedWhenGlassesRemoved) {
      throw new Error("Pet screenshots did not change across accessory toggles");
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.stack : String(error),
      runDir
    };
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
}

await main();
