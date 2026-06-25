export const WEBGL_DIAGNOSTIC_SHORTCUT = "Ctrl+Alt+Shift+L";

export type DiagnosticShortcutRegistration = {
  accelerator: string;
  registered: boolean;
  reason: "packaged" | "registered" | "unavailable";
};

export type DiagnosticShortcutTarget = {
  isDestroyed(): boolean;
  webContents: {
    send(channel: string): void;
  };
};

export function registerWebGLDiagnosticShortcut(options: {
  isPackaged: boolean;
  register: (accelerator: string, callback: () => void) => boolean;
  onTriggered: () => void;
}): DiagnosticShortcutRegistration {
  if (options.isPackaged) {
    return {
      accelerator: WEBGL_DIAGNOSTIC_SHORTCUT,
      registered: false,
      reason: "packaged"
    };
  }

  const registered = options.register(WEBGL_DIAGNOSTIC_SHORTCUT, options.onTriggered);

  return {
    accelerator: WEBGL_DIAGNOSTIC_SHORTCUT,
    registered,
    reason: registered ? "registered" : "unavailable"
  };
}

export function sendWebGLDiagnosticTrigger(target: DiagnosticShortcutTarget | null): boolean {
  if (!target || target.isDestroyed()) {
    return false;
  }

  target.webContents.send("pet:inject-webgl-context-loss");
  return true;
}
