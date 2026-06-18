import type { EmotionTag } from "./emotion";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

export type FakeReply = {
  text: string;
  emotion: EmotionTag;
};
