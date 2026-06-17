export type PetWindowCommand =
  | { type: "pet:first-frame" }
  | { type: "pet:health"; payload: RenderHealth };

export type ChatWindowCommand =
  | { type: "chat:open" }
  | { type: "chat:focus-input" };

export type RenderHealth = {
  framesPerSecond: number;
  isContextLost: boolean;
  timestamp: number;
};

export type PetApi = {
  reportFirstFrame(): void;
  reportRenderHealth(state: RenderHealth): void;
  openChat(): void;
};

export type ChatApi = {
  focusInput(): void;
};
