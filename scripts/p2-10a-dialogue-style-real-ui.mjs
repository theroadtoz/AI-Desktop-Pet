import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join(root, ".tmp", "p2-10a-dialogue-style-real-ui", stamp);
const appDataDir = join(runDir, "user-data");
const resultPath = join(runDir, "result.json");
const progressPath = join(runDir, "progress.log");
const port = Number(process.env.P2_10A_CDP_PORT || 9510);
const forbiddenTexts = [
  "P2-10A 用户正文哨兵",
  "P2-10A 事实卡正文哨兵",
  "sk-p2-10a",
  "provider request body",
  "表达风格：低打扰桌面伙伴"
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

function runBuild() {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", "npm.cmd run build"], { cwd: root, stdio: "inherit" });
  }

  return spawn("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
}

async function stopElectron(child, handles) {
  handles.pet?.cdp.close();
  handles.chat?.cdp.close();
  child?.kill();
  await sleep(1_000);
}

async function sendChat(cdp, text) {
  const before = await evaluate(cdp, "document.querySelectorAll('.message-pet .message-content').length");
  await evaluate(cdp, `
    (() => {
      const input = document.querySelector('#chat-input');
      const form = document.querySelector('#chat-form');
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();
    })()
  `);
  await waitFor(cdp, `document.querySelectorAll('.message-pet .message-content').length > ${before}`);
  await waitFor(cdp, `
    (() => {
      const replies = [...document.querySelectorAll('.message-pet .message-content')];
      return replies.at(-1)?.textContent.trim().length > 0 && !document.querySelector('#send-button')?.disabled;
    })()
  `, 20_000);
  return evaluate(cdp, "[...document.querySelectorAll('.message-pet .message-content')].at(-1)?.textContent.trim()");
}

function readTelemetrySummary() {
  const logDirectory = join(appDataDir, "logs");
  if (!existsSync(logDirectory)) {
    return { logDirectory, files: [], eventCount: 0, containsForbiddenText: false };
  }

  const files = readdirSync(logDirectory)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDirectory, name))
    .sort();
  let eventCount = 0;
  let containsForbiddenText = false;

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    containsForbiddenText ||= forbiddenTexts.some((item) => text.includes(item));
    eventCount += text.split(/\r?\n/).filter((line) => line.trim()).length;
  }

  return { logDirectory, files, eventCount, containsForbiddenText };
}

async function main() {
  log("building app");
  const build = runBuild();
  const buildCode = await new Promise((resolveBuild) => build.on("exit", resolveBuild));
  if (buildCode !== 0) {
    throw new Error(`build failed: ${buildCode}`);
  }

  const child = launchElectron();
  const handles = {};
  const checks = {};

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 30_000);
    handles.pet = await connectTarget("renderer/pet/index.html");
    await sleep(1_000);
    await evaluate(handles.pet.cdp, "window.petApi?.openChat()");
    handles.chat = await connectTarget("renderer/chat/index.html");
    await waitFor(handles.chat.cdp, "document.querySelector('#provider-status')?.textContent.includes('Fake Provider')");

    log("sending fake provider chat samples");
    const neutralReply = await sendChat(handles.chat.cdp, "P2-10A 用户正文哨兵，帮我整理一下。");
    const happyReply = await sendChat(handles.chat.cdp, "今天很开心，谢谢你。");
    const sadReply = await sendChat(handles.chat.cdp, "我有点难过，压力也很大。");

    checks.fakeRepliesNonEmpty = [neutralReply, happyReply, sadReply].every((reply) => typeof reply === "string" && reply.length > 0);
    checks.fakeRepliesShort = [neutralReply, happyReply, sadReply].every((reply) => reply.length <= 40);
    checks.fakeRepliesVaried = new Set([neutralReply, happyReply, sadReply]).size > 1;

    log("checking memory injection counts");
    const zeroCount = await evaluate(handles.chat.cdp, `
      new Promise((resolve) => {
        const off = window.chatApi.onMemoryInjection((payload) => {
          off();
          resolve(payload.count);
        });
        const input = document.querySelector('#chat-input');
        const form = document.querySelector('#chat-form');
        input.value = '没有事实卡时的记忆检查';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        form.requestSubmit();
      })
    `);
    await waitFor(handles.chat.cdp, "!document.querySelector('#send-button')?.disabled", 20_000);
    checks.memoryEmptyCount = zeroCount === 0;

    const cardCount = await evaluate(handles.chat.cdp, `
      (async () => {
        await window.memoryApi.setEnabled(true);
        await window.memoryApi.createCard({
          title: 'P2-10A验收',
          content: 'P2-10A 事实卡正文哨兵',
          tags: ['验收'],
          sourceConversationId: crypto.randomUUID()
        });
        return new Promise((resolve) => {
          const off = window.chatApi.onMemoryInjection((payload) => {
            off();
            resolve(payload.count);
          });
          const input = document.querySelector('#chat-input');
          const form = document.querySelector('#chat-form');
          input.value = '事实卡启用时的记忆检查';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          form.requestSubmit();
        });
      })()
    `);
    await waitFor(handles.chat.cdp, "!document.querySelector('#send-button')?.disabled", 20_000);
    checks.memoryEnabledCount = cardCount === 1;

    const telemetry = readTelemetrySummary();
    checks.telemetryPrivacy = telemetry.containsForbiddenText === false;

    const result = {
      ok: Object.values(checks).every(Boolean),
      checks,
      replies: { neutralReply, happyReply, sadReply },
      telemetry: {
        logDirectory: telemetry.logDirectory,
        fileCount: telemetry.files.length,
        eventCount: telemetry.eventCount,
        containsForbiddenText: telemetry.containsForbiddenText
      }
    };
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);

    if (!result.ok) {
      throw new Error(`P2-10A real UI checks failed: ${JSON.stringify(checks)}`);
    }

    log(`passed: ${resultPath}`);
  } finally {
    await stopElectron(child, handles);
  }
}

main().catch((error) => {
  const result = {
    ok: false,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    telemetry: readTelemetrySummary()
  };
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.error(result.error);
  process.exitCode = 1;
}).finally(() => {
  if (process.env.P2_10A_KEEP_TMP !== "1") {
    rmSync(runDir, { recursive: true, force: true });
  }
});
