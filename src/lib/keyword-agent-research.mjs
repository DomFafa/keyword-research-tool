import { detectResearchNeeds } from "./keyword-research-boundary.mjs";
import { createNoopResearchProvider } from "./keyword-research-provider.mjs";

function limitText(value, limit) {
  return String(value || "").slice(0, limit);
}

function researchInput(item, researchNeeds) {
  return {
    keyword: item.keyword,
    country: item.keywordRecord?.["国家"] || item.keywordRecord?.country || "",
    reasons: researchNeeds.reasons,
    desiredIntent: item.rule?.["意图"] || ""
  };
}

function noResearch(researchNeeds) {
  return {
    needed: false,
    reasons: researchNeeds.reasons,
    level: researchNeeds.level
  };
}

export async function enrichItemsWithResearch(items, {
  enabled = false,
  provider = createNoopResearchProvider(),
  maxResearchItems = 5,
  failOpen = true
} = {}) {
  if (!enabled) {
    return items;
  }

  let researchCount = 0;
  const enriched = [];
  for (const item of items) {
    const researchNeeds = detectResearchNeeds({
      keyword: item.keyword,
      rule: item.rule,
      keywordRecord: item.keywordRecord
    });

    if (!researchNeeds.needed) {
      enriched.push({
        ...item,
        research: noResearch(researchNeeds)
      });
      continue;
    }

    if (researchCount >= maxResearchItems) {
      enriched.push({
        ...item,
        research: {
          needed: true,
          skipped: true,
          skipReason: "max_research_items_reached",
          reasons: researchNeeds.reasons,
          level: researchNeeds.level
        }
      });
      continue;
    }

    researchCount += 1;
    try {
      const result = await provider.researchKeyword(researchInput(item, researchNeeds));
      enriched.push({
        ...item,
        research: {
          needed: true,
          reasons: researchNeeds.reasons,
          level: researchNeeds.level,
          provider: result.provider || provider.name || "",
          skipped: Boolean(result.skipped),
          findings: Array.isArray(result.findings) ? result.findings : [],
          summary: String(result.summary || ""),
          confidence: result.confidence || "none"
        }
      });
    } catch (error) {
      if (!failOpen) {
        throw error;
      }
      enriched.push({
        ...item,
        research: {
          needed: true,
          reasons: researchNeeds.reasons,
          level: researchNeeds.level,
          provider: provider.name || "",
          skipped: false,
          findings: [],
          summary: "",
          confidence: "none",
          error: error.message || String(error)
        }
      });
    }
  }
  return enriched;
}

export function summarizeResearchForPrompt(research) {
  if (!research) {
    return { needed: false, reasons: [], confidence: "none", summary: "", topFindings: [] };
  }

  return {
    needed: Boolean(research.needed),
    reasons: Array.isArray(research.reasons) ? research.reasons : [],
    confidence: research.confidence || "none",
    summary: limitText(research.summary, 500),
    topFindings: (Array.isArray(research.findings) ? research.findings : [])
      .slice(0, 3)
      .map((finding) => ({
        title: String(finding?.title || ""),
        url: String(finding?.url || ""),
        snippet: limitText(finding?.snippet, 160)
      }))
  };
}
