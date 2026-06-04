import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDomainCandidates,
  DOMAIN_NOT_FOUND_STATUS,
  isAWithoutDomainRecommendation,
  isWorkspaceNoLongerAvailableMessage,
  keywordWordsForDomain,
  parseAvailablePrice,
  parseWorkspaceDomainConfirmation,
  selectDomainResearchRows
} from "../src/lib/workspace-domain-research.mjs";

test("buildDomainCandidates follows the configured suffix order", () => {
  assert.deepEqual(buildDomainCandidates("mla citation generator"), [
    "mlacitationgenerator.com",
    "mlacitationgenerator.org",
    "mlacitationgenerator.net",
    "mla-citation-generator.com",
    "mla-citation-generator.org",
    "mla-citation-generator.net",
    "mlacitationgenerator.online",
    "mlacitationgenerator.app",
    "mlacitationgenerator.pro",
    "mlacitationgenerator.site"
  ]);
});

test("buildDomainCandidates adapts dashed format to keyword word count", () => {
  assert.deepEqual(buildDomainCandidates("qr generator").slice(3, 6), [
    "qr-generator.com",
    "qr-generator.org",
    "qr-generator.net"
  ]);
  assert.deepEqual(buildDomainCandidates("free qr code generator").slice(3, 6), [
    "free-qr-code-generator.com",
    "free-qr-code-generator.org",
    "free-qr-code-generator.net"
  ]);
});

test("keywordWordsForDomain strips punctuation and existing suffixes", () => {
  assert.deepEqual(keywordWordsForDomain("MLA Citation Generator.com"), [
    "mla",
    "citation",
    "generator"
  ]);
});

test("selectDomainResearchRows only selects A rows missing domain recommendation", () => {
  const rows = [
    { rowNumber: 2, record: { "关键词": "a", "评级": "A", "域名推荐": "" } },
    { rowNumber: 3, record: { "关键词": "b", "评级": "B", "域名推荐": "" } },
    { rowNumber: 4, record: { "关键词": "c", "评级": "A", "域名推荐": "c.com" } },
    { rowNumber: 5, record: { "关键词": "d", "评级": "A", "域名推荐": "" } }
  ];
  const result = selectDomainResearchRows(rows, { limit: 2 });
  assert.deepEqual(result.selected.map((row) => row.rowNumber), [2, 5]);
  assert.equal(isAWithoutDomainRecommendation(rows[0].record), true);
  assert.equal(isAWithoutDomainRecommendation(rows[2].record), false);
});

test("parseWorkspaceDomainConfirmation extracts available domain and price", () => {
  const result = parseWorkspaceDomainConfirmation(
    "The domain you want is available! mla-citation-generator.org Available ₺75.00 TRY/year",
    "mla-citation-generator.org"
  );
  assert.deepEqual(result, {
    available: true,
    domain: "mla-citation-generator.org",
    price: "₺75.00 TRY/year",
    reason: ""
  });
});

test("parseAvailablePrice handles missing prices and not-found status is stable", () => {
  assert.equal(parseAvailablePrice("Available"), "");
  assert.equal(DOMAIN_NOT_FOUND_STATUS, "未找到可用域名");
});

test("isWorkspaceNoLongerAvailableMessage detects transient domain failures", () => {
  assert.equal(
    isWorkspaceNoLongerAvailableMessage("The selected domain name is no longer available."),
    true
  );
  assert.equal(isWorkspaceNoLongerAvailableMessage("mlacitationgenerator.org Unavailable"), false);
});
