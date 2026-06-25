import type { EmotionClassification } from "./emotion";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

export type FakeReply = EmotionClassification & {
  text: string;
};
