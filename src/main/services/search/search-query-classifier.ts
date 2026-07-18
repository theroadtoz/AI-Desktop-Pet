import type { WebSearchReasonCode } from "../../../shared/web-search";

export type SearchQueryClassification = {
  shouldSearch: boolean;
  reasonCodes: WebSearchReasonCode[];
};

const EXPLICIT_SEARCH_PATTERN =
  /(联网|上网|网络|网页|web|internet|mcp).{0,8}(搜索|查询|查找|查证|检索|找一下|看一下)|(?:搜索|查一下|查找|检索|查证|搜一下|搜搜|看看网上|网上看看)/i;
const SEARCH_FEATURE_DESIGN_PATTERN =
  /(?:设计|方案|策略|机制|功能|设置).{0,10}(?:怎么样|怎么(?:工作|运作|运行|实现)|如何(?:工作|运作|运行|实现)?|合理|好不好|看法)|(?:怎么样|怎么(?:工作|运作|运行|实现)|如何(?:工作|运作|运行|实现)?|是否合理|好不好).{0,10}(?:设计|方案|策略|机制|功能|设置)/i;
const EXPLICIT_SEARCH_DIRECTIVE_PATTERN =
  /(?:请(?:帮我|替我|为我)?|帮我|替我|给我)(?:(?:联网|上网|网络|网页|web|internet|mcp).{0,8})?(?:搜索|搜一下|查询|查一下|查找|查证|检索|找一下|看一下)|(?:^|[。！？?!，,；;])(?:再|然后|并|接着|随后)(?:(?:联网|上网|网络|网页|web|internet|mcp).{0,8})?(?:搜索|搜一下|查询|查一下|查找|查证|检索)/i;

const FRESHNESS_PATTERN =
  /(最新|实时|刚刚|新闻|价格|股价|汇率|天气|政策|法规|版本|发布日期|下载链接|官网|赛程|比分|总统|CEO|首席执行官)/i;

const QUESTION_PATTERN =
  /(吗|么|呢|几|多少|如何|怎么|是什么|是哪|有没有|是否|请问|\?|\？)/;
const FRESHNESS_REQUEST_PATTERN =
  /(告诉|介绍|列出|汇总|给我|说说|看看|查查|找找).{0,16}(最新|实时|刚刚|新闻|价格|股价|汇率|天气|政策|法规|版本|发布日期|下载链接|官网|赛程|比分|总统|CEO|首席执行官)|(最新|实时|刚刚|新闻|价格|股价|汇率|天气|政策|法规|版本|发布日期|下载链接|官网|赛程|比分|总统|CEO|首席执行官).{0,16}(告诉|介绍|列出|汇总|给我|说说|看看|查查|找找)/i;

export function classifySearchQuery(input: string): SearchQueryClassification {
  const text = normalizeText(input);
  const reasonCodes: WebSearchReasonCode[] = [];

  if (!text) {
    return {
      shouldSearch: false,
      reasonCodes: ["empty_query"]
    };
  }

  const discussesSearchFeatureDesign = SEARCH_FEATURE_DESIGN_PATTERN.test(text) &&
    !EXPLICIT_SEARCH_DIRECTIVE_PATTERN.test(text);

  if (EXPLICIT_SEARCH_PATTERN.test(text) && !discussesSearchFeatureDesign) {
    reasonCodes.push("explicit_search_request");
  }

  if (
    (FRESHNESS_PATTERN.test(text) && QUESTION_PATTERN.test(text)) ||
    FRESHNESS_REQUEST_PATTERN.test(text)
  ) {
    reasonCodes.push("freshness_required");
  }

  if (reasonCodes.length === 0) {
    return {
      shouldSearch: false,
      reasonCodes: ["no_search_needed"]
    };
  }

  return {
    shouldSearch: true,
    reasonCodes
  };
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
