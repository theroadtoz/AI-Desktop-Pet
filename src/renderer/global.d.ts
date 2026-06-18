import type { ChatApi, ConfigApi, PetApi } from "../shared/ipc-contract";

declare global {
  interface Window {
    petApi?: PetApi;
    chatApi?: ChatApi;
    configApi?: ConfigApi;
  }
}

export {};
