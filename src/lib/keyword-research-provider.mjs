function normalizeConfidence(value) {
  return ["none", "low", "medium", "high"].includes(value) ? value : "none";
}

function normalizeFindings(findings) {
  return Array.isArray(findings)
    ? findings.map((finding) => ({
        title: String(finding?.title || ""),
        url: String(finding?.url || ""),
        snippet: String(finding?.snippet || "")
      }))
    : [];
}

function normalizeResearchResult(result, { provider, keyword }) {
  return {
    provider,
    keyword,
    skipped: Boolean(result?.skipped),
    findings: normalizeFindings(result?.findings),
    summary: String(result?.summary || ""),
    confidence: normalizeConfidence(result?.confidence)
  };
}

export function createNoopResearchProvider() {
  return {
    name: "noop",
    async researchKeyword(input) {
      return {
        provider: "noop",
        keyword: input.keyword,
        skipped: true,
        findings: [],
        summary: "",
        confidence: "none"
      };
    }
  };
}

export function createMockResearchProvider(fixtures = {}) {
  return {
    name: "mock",
    async researchKeyword(input) {
      const fixture = fixtures[input.keyword] || {};
      if (fixture instanceof Error) {
        throw fixture;
      }
      if (typeof fixture === "function") {
        return fixture(input);
      }
      return {
        provider: "mock",
        keyword: input.keyword,
        skipped: Boolean(fixture.skipped),
        findings: normalizeFindings(fixture.findings),
        summary: String(fixture.summary || ""),
        confidence: normalizeConfidence(fixture.confidence || "none")
      };
    }
  };
}

export function createHttpResearchProvider({ endpoint, apiKey = "" } = {}) {
  if (!endpoint) {
    throw new Error("缺少 keyword research endpoint。请设置 --research-endpoint 或 KEYWORD_RESEARCH_ENDPOINT。");
  }

  return {
    name: "http",
    async researchKeyword(input) {
      const headers = {
        "content-type": "application/json"
      };
      if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          keyword: input.keyword,
          country: input.country || "",
          reasons: input.reasons || [],
          desiredIntent: input.desiredIntent || ""
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`Keyword research provider failed: HTTP ${response.status} ${data?.error || response.statusText}`);
      }
      return normalizeResearchResult(data, {
        provider: "http",
        keyword: input.keyword
      });
    }
  };
}
