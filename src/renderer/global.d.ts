import type { ChatApi, ConfigApi, DialogueAffectApi, EnvironmentActionApi, HistoryApi, LocalRuntimeApi, MemoryApi, PetApi, PetPresentationApi, ProactiveCompanionApi, ShortcutApi, UserProfileApi, WebSearchApi } from "../shared/ipc-contract";

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
    dialogueAffectApi?: DialogueAffectApi;
    userProfileApi?: UserProfileApi;
    webSearchApi?: WebSearchApi;
  }
}

export {};
