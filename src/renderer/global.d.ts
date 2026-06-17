import type { ChatApi, PetApi } from "../shared/ipc-contract";

declare global {
  interface Window {
    petApi?: PetApi;
    chatApi?: ChatApi;
  }
}

export {};
