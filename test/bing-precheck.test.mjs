import assert from "node:assert/strict";
import test from "node:test";
import {
  competitionKeyFromUrl,
  evaluateBingPrecheck,
  parseCompactNumber,
  sortCountryBreakdown,
  summarizeTopUrlCompetition
} from "../src/lib/bing-precheck.mjs";
import { keywordResearchUrlMatchesSite } from "../src/lib/bing-page.mjs";

test("parseCompactNumber converts Bing shorthand metrics", () => {
  assert.equal(parseCompactNumber("16.9K"), 16900);
  assert.equal(parseCompactNumber("472.7K"), 472700);
  assert.equal(parseCompactNumber("1.2M"), 1200000);
  assert.equal(parseCompactNumber("308"), 308);
});

test("keywordResearchUrlMatchesSite requires the expected siteUrl", () => {
  assert.equal(
    keywordResearchUrlMatchesSite(
      "https://www.bing.com/webmasters/keywordresearch?siteUrl=https%3A%2F%2F2fafree.com%2F&keyword=test",
      "https://2fafree.com/"
    ),
    true
  );
  assert.equal(
    keywordResearchUrlMatchesSite(
      "https://www.bing.com/webmasters/keywordresearch?siteUrl=https%3A%2F%2Fbackwardstextgenerator.com%2F&keyword=test",
      "https://2fafree.com/"
    ),
    false
  );
});

test("competitionKeyFromUrl keeps root domains and locale paths", () => {
  assert.equal(competitionKeyFromUrl("https://www.example.com/en"), "example.com/en");
  assert.equal(competitionKeyFromUrl("https://www.example.com/en/tool"), "");
  assert.equal(competitionKeyFromUrl("https://barcode-maker.com/"), "barcode-maker.com");
  assert.equal(competitionKeyFromUrl("https://m.example.co.uk/fr-ca"), "example.co.uk/fr-ca");
  assert.equal(competitionKeyFromUrl("https://barcodx.com/online-barcode-generator"), "");
});

test("summarizeTopUrlCompetition counts unique top five competition keys", () => {
  const result = summarizeTopUrlCompetition([
    "https://a.com/en/tool",
    "https://a.com/en/other",
    "https://a.com/fr",
    "https://b.com/",
    "https://c.com/tool",
    "https://d.com/tool"
  ]);

  assert.equal(result.count, 2);
  assert.deepEqual(result.domains, [
    { domain: "a.com/fr", rank: 3 },
    { domain: "b.com", rank: 4 }
  ]);
});

test("evaluateBingPrecheck rejects when either rule fails", () => {
  assert.equal(
    evaluateBingPrecheck({
      impressions: "999",
      minImpressions: "1000",
      top5DomainCount: 2,
      maxTop5Domains: 2
    }).judgement,
    "拒绝"
  );
  assert.equal(
    evaluateBingPrecheck({
      impressions: "10K",
      minImpressions: "1000",
      top5DomainCount: 3,
      maxTop5Domains: 2
    }).judgement,
    "拒绝"
  );
  assert.equal(
    evaluateBingPrecheck({
      impressions: "10K",
      minImpressions: "1000",
      top5DomainCount: 2,
      maxTop5Domains: 2
    }).judgement,
    "待定"
  );
  assert.equal(
    evaluateBingPrecheck({
      impressions: "10K",
      minImpressions: "1000",
      top5DomainCount: 1,
      maxTop5Domains: 2
    }).judgement,
    "继续"
  );
});

test("sortCountryBreakdown ranks countries by impressions", () => {
  assert.deepEqual(
    sortCountryBreakdown([
      { country: "United States", impressions: "161.1K" },
      { country: "India", impressions: "76.7K" },
      { country: "Germany", impressions: "31.8K" }
    ]).map((row) => row.country),
    ["United States", "India", "Germany"]
  );
});
