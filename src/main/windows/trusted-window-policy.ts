export type ExternalUrlOpener = (url: string) => unknown;

interface TrustedNavigationEvent {
  url: string;
  preventDefault(): void;
}

interface TrustedWindowWebContents {
  on(
    event: "will-navigate",
    listener: (event: TrustedNavigationEvent) => void
  ): unknown;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" }
  ): void;
}

function parseExternalUrl(value: string): URL | undefined {
  if (value.length === 0 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function openExternalUrl(value: string, opener: ExternalUrlOpener): void {
  const parsed = parseExternalUrl(value);
  if (!parsed) {
    return;
  }

  try {
    void Promise.resolve(opener(parsed.href)).catch(() => undefined);
  } catch {
    // A system opener failure must not restore in-app navigation.
  }
}

export function installTrustedWindowPolicy(
  webContents: TrustedWindowWebContents,
  opener: ExternalUrlOpener
): void {
  webContents.on("will-navigate", (event) => {
    event.preventDefault();
    openExternalUrl(event.url, opener);
  });

  webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url, opener);
    return { action: "deny" };
  });
}
