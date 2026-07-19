import type { ChatApi, ConfigApi, EnvironmentActionApi, HistoryApi, LocalRuntimeApi, MemoryApi, PetApi, PetPresentationApi, ProactiveCompanionApi, ShortcutApi, UserProfileApi, WebSearchApi } from "../shared/ipc-contract";

declare global {
  interface Window {
    petApi?: PetApi;
    chatApi?: ChatApi;
    configApi?: ConfigApi;
    localRuntimeApi?: LocalRuntimeApi;
    historyApi?: HistoryApi;
    memoryApi?: MemoryApi;
    petPresentationApi?: PetPresentationApi;
    shortcutApi?: ShortcutApi;
    proactiveCompanionApi?: ProactiveCompanionApi;
    environmentActionApi?: EnvironmentActionApi;
    userProfileApi?: UserProfileApi;
    webSearchApi?: WebSearchApi;
  }
}

export {};
