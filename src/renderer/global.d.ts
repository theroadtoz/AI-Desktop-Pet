import type { ChatApi, ConfigApi, DialogueModeApi, EnvironmentActionApi, HistoryApi, LocalRuntimeApi, MemoryApi, PetApi, PetPresentationApi, PresenceModeApi, ProactiveCompanionApi, ShortcutApi, UserProfileApi, WebSearchApi } from "../shared/ipc-contract";

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
    dialogueModeApi?: DialogueModeApi;
    presenceModeApi?: PresenceModeApi;
    proactiveCompanionApi?: ProactiveCompanionApi;
    environmentActionApi?: EnvironmentActionApi;
    userProfileApi?: UserProfileApi;
    webSearchApi?: WebSearchApi;
  }
}

export {};
