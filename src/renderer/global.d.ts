import type { ChatApi, ConfigApi, DialogueModeApi, HistoryApi, LocalRuntimeApi, MemoryApi, PetApi, PetPresentationApi, PresenceModeApi, ShortcutApi, UserProfileApi, WebSearchApi } from "../shared/ipc-contract";

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
    userProfileApi?: UserProfileApi;
    webSearchApi?: WebSearchApi;
  }
}

export {};
