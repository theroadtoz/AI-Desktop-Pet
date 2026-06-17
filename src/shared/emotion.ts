export const emotionTags = [
  "neutral",
  "happy",
  "sad",
  "surprised",
  "confused",
  "angry"
] as const;

export type EmotionTag = (typeof emotionTags)[number];
