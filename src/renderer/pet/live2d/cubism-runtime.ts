import { CUBISM_CORE_SCRIPT_URL } from "./cubism-assets";

type CubismFrameworkModule = typeof import("./vendor/framework/live2dcubismframework");

declare global {
  interface Window {
    Live2DCubismCore?: typeof Live2DCubismCore;
  }
}

let runtimePromise: Promise<CubismFrameworkModule> | null = null;

function loadCoreScript(): Promise<void> {
  if (window.Live2DCubismCore) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CUBISM_CORE_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("failed to load Cubism Core"));
    document.head.append(script);
  });
}

export function initializeCubismRuntime(): Promise<CubismFrameworkModule> {
  runtimePromise ??= (async () => {
    await loadCoreScript();

    const frameworkModule = await import("./vendor/framework/live2dcubismframework");
    const option = new frameworkModule.Option();
    option.logFunction = (message: string) => {
      console.debug("[cubism]", message.trim());
    };
    option.loggingLevel = frameworkModule.LogLevel.LogLevel_Warning;

    if (!frameworkModule.CubismFramework.isStarted()) {
      frameworkModule.CubismFramework.startUp(option);
    }

    if (!frameworkModule.CubismFramework.isInitialized()) {
      frameworkModule.CubismFramework.initialize();
    }

    return frameworkModule;
  })();

  return runtimePromise;
}
