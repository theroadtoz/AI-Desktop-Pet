const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");

const outputPath = process.env.P2_8I_CLICK_TARGET_RESULT;
let clickCount = 0;

function writeResult(extra = {}) {
  if (!outputPath) {
    return;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    clickCount,
    updatedAt: new Date().toISOString(),
    ...extra
  }, null, 2));
}

app.whenReady().then(() => {
  const targetWindow = new BrowserWindow({
    width: 640,
    height: 480,
    x: Number(process.env.P2_8I_CLICK_TARGET_X ?? 240),
    y: Number(process.env.P2_8I_CLICK_TARGET_Y ?? 120),
    title: "P2-8I Click Target",
    backgroundColor: "#f4f7fb",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  ipcMain.on("target-clicked", () => {
    clickCount += 1;
    writeResult({ event: "target-clicked" });
  });

  writeResult({ event: "ready" });
  targetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>P2-8I Click Target</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            font-family: system-ui, sans-serif;
            background: #f4f7fb;
            color: #18324a;
          }
          button {
            width: 420px;
            height: 260px;
            border: 2px solid #2a6f97;
            border-radius: 8px;
            background: #e0f2fe;
            color: #18324a;
            font-size: 28px;
            font-weight: 700;
          }
        </style>
      </head>
      <body>
        <button id="target" type="button">P2-8I CLICK TARGET</button>
        <script>
          const { ipcRenderer } = require("electron");
          document.querySelector("#target").addEventListener("click", () => {
            ipcRenderer.send("target-clicked");
          });
        </script>
      </body>
    </html>
  `)}`);
});

app.on("window-all-closed", () => {
  app.quit();
});
