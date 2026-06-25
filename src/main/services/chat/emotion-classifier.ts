import type { EmotionClassification, EmotionIntensity, EmotionTag } from "../../../shared/emotion";

const KEYWORD_RULES: readonly {
  emotion: EmotionTag;
  keywords: Readonly<Record<EmotionIntensity, readonly string[]>>;
}[] = [
  {
    emotion: "happy",
    keywords: {
      low: ["开心", "高兴", "喜欢", "谢谢"],
      medium: ["太好了", "很棒", "不错"],
      high: ["太开心了", "开心死了", "超级开心", "激动坏了"]
    }
  },
  {
    emotion: "sad",
    keywords: {
      low: ["难过", "伤心", "委屈", "担心"],
      medium: ["焦虑", "害怕", "压力", "糟糕"],
      high: ["难过死了", "伤心死了", "崩溃了", "绝望了"]
    }
  },
  {
    emotion: "angry",
    keywords: {
      low: ["生气", "烦", "讨厌"],
      medium: ["气死", "离谱"],
      high: ["气死我了", "太气人了", "怒不可遏"]
    }
  },
  {
    emotion: "surprised",
    keywords: {
      low: ["惊讶", "没想到"],
      medium: ["震惊", "居然", "真的假的"],
      high: ["太震惊了", "难以置信", "完全没想到"]
    }
  },
  {
    emotion: "confused",
    keywords: {
      low: ["不懂", "困惑"],
      medium: ["为什么", "怎么回事"],
      high: ["完全不懂", "彻底糊涂了"]
    }
  }
];

const INTENSITIES_DESCENDING: readonly EmotionIntensity[] = ["high", "medium", "low"];

export function classifyEmotion(input: {
  latestUserMessage?: string;
  assistantReply?: string;
}): EmotionClassification {
  const text = `${input.latestUserMessage ?? ""}\n${input.assistantReply ?? ""}`;
  const matches = KEYWORD_RULES.flatMap((rule) => {
    const intensity = INTENSITIES_DESCENDING.find((candidate) =>
      rule.keywords[candidate].some((keyword) => text.includes(keyword))
    );

    return intensity ? [{ emotion: rule.emotion, intensity }] : [];
  });

  if (matches.length !== 1) {
    return { emotion: "neutral", intensity: "low" };
  }

  return matches[0]!;
}
