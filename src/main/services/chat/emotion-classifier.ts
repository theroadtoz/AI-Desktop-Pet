import type { EmotionTag } from "../../../shared/emotion";

const KEYWORD_RULES: readonly {
  emotion: EmotionTag;
  keywords: readonly string[];
}[] = [
  { emotion: "happy", keywords: ["开心", "高兴", "太好了", "喜欢", "棒", "不错", "谢谢"] },
  { emotion: "sad", keywords: ["难过", "伤心", "委屈", "担心", "焦虑", "害怕", "压力", "糟糕"] },
  { emotion: "angry", keywords: ["生气", "烦", "讨厌", "气死", "离谱"] },
  { emotion: "surprised", keywords: ["惊讶", "震惊", "没想到", "居然", "真的假的"] },
  { emotion: "confused", keywords: ["不懂", "困惑", "为什么", "怎么回事"] }
];

export function classifyEmotion(input: {
  latestUserMessage?: string;
  assistantReply?: string;
}): EmotionTag {
  const text = `${input.latestUserMessage ?? ""}\n${input.assistantReply ?? ""}`;

  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.emotion;
    }
  }

  return "neutral";
}
