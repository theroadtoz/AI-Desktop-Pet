export type AppShutdownDependencies = {
  quiesce(): void | Promise<void>;
  stopAsyncResources(): Promise<void>;
  destroyWindows(): void | Promise<void>;
  finalQuit(): void;
  reportError?(error: unknown): void;
};

export type AppShutdownCoordinator = {
  isQuiescing(): boolean;
  shouldAllowFinalQuit(): boolean;
  shutdown(): Promise<void>;
};

export function shouldHideChatWindowOnClose(isAppQuiescing: boolean): boolean {
  return !isAppQuiescing;
}

export function createAppShutdownCoordinator(
  dependencies: AppShutdownDependencies
): AppShutdownCoordinator {
  let quiescing = false;
  let allowFinalQuit = false;
  let shutdownPromise: Promise<void> | null = null;

  async function runStep(step: () => void | Promise<void>): Promise<void> {
    try {
      await step();
    } catch (error: unknown) {
      dependencies.reportError?.(error);
    }
  }

  function shutdown(): Promise<void> {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    quiescing = true;
    shutdownPromise = (async () => {
      await runStep(dependencies.quiesce);
      await runStep(dependencies.stopAsyncResources);
      await runStep(dependencies.destroyWindows);
      allowFinalQuit = true;
      dependencies.finalQuit();
    })();
    return shutdownPromise;
  }

  return {
    isQuiescing() {
      return quiescing;
    },
    shouldAllowFinalQuit() {
      return allowFinalQuit;
    },
    shutdown
  };
}
