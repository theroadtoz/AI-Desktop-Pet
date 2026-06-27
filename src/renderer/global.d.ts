import type { ChatApi, ConfigApi, DialogueModeApi, HistoryApi, MemoryApi, PetApi, PetPresentationApi, ShortcutApi, UserProfileApi } from "../shared/ipc-contract";

declare global {
  interface Window {
    petApi?: PetApi;
    chatApi?: ChatApi;
    configApi?: ConfigApi;
    historyApi?: HistoryApi;
    memoryApi?: MemoryApi;
    petPresentationApi?: PetPresentationApi;
    shortcutApi?: ShortcutApi;
    dialogueModeApi?: DialogueModeApi;
    userProfileApi?: UserProfileApi;
  }
}

export {};
