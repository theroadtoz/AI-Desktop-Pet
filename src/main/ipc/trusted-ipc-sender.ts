import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type TrustedIpcDocumentRole = "chat" | "pet";

export interface TrustedIpcFrame {
  url: string;
}

export interface TrustedIpcWebContents {
  readonly mainFrame: TrustedIpcFrame;
  isDestroyed(): boolean;
}

export interface TrustedIpcWindow {
  readonly webContents: TrustedIpcWebContents;
  isDestroyed(): boolean;
}

export interface TrustedIpcEvent {
  readonly sender: TrustedIpcWebContents;
  readonly senderFrame: TrustedIpcFrame | null;
}

function normalizeDocumentPath(value: string): string {
  const normalized = normalize(resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isTrustedRoleDocument(
  url: string,
  role: TrustedIpcDocumentRole,
  rendererRoot: string
): boolean {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "file:" || parsed.search !== "" || parsed.hash !== "") {
    return false;
  }

  try {
    const expectedPath = join(rendererRoot, role, "index.html");
    return normalizeDocumentPath(fileURLToPath(parsed)) === normalizeDocumentPath(expectedPath);
  } catch {
    return false;
  }
}

export function isTrustedIpcSender(
  event: TrustedIpcEvent,
  window: TrustedIpcWindow | null,
  role: TrustedIpcDocumentRole,
  rendererRoot: string
): boolean {
  if (!window || window.isDestroyed()) {
    return false;
  }

  const webContents = window.webContents;
  if (webContents.isDestroyed() || event.sender !== webContents) {
    return false;
  }

  const senderFrame = event.senderFrame;
  if (!senderFrame || senderFrame !== webContents.mainFrame) {
    return false;
  }

  return isTrustedRoleDocument(senderFrame.url, role, rendererRoot);
}
