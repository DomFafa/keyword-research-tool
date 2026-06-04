import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDomainInfoStatusUpdates,
  companyNameFromDomain,
  DOMAIN_INFO_NOT_FOUND,
  hasCompleteAddressInfo,
  normalizeAddressInfo,
  normalizeTurkishPhone,
  parseTurkishAddress,
  selectDomainInfoFillRows
} from "../src/lib/domain-info-fill.mjs";

test("companyNameFromDomain removes the final domain suffix", () => {
  assert.equal(companyNameFromDomain("mla-citation-generator.org"), "mla-citation-generator");
  assert.equal(companyNameFromDomain("tool.example.co"), "tool.example");
});

test("parseTurkishAddress splits street, postal code, city, and state", () => {
  assert.deepEqual(
    parseTurkishAddress("Hacıahmet, Kurtuluş Deresi Cd. No:63, 34852 Beyoğlu/İstanbul, Turkey"),
    {
      address: "Hacıahmet, Kurtuluş Deresi Cd. No:63",
      postalCode: "34852",
      city: "Beyoğlu",
      state: "İstanbul"
    }
  );
});

test("normalizeAddressInfo formats phone numbers and parsed address fields", () => {
  assert.deepEqual(
    normalizeAddressInfo({
      street: "Hacıahmet, Kurtuluş Deresi Cd. No:63, 34852 Beyoğlu/İstanbul, Turkey",
      city: "Istanbul",
      postalCode: "34852",
      phone: "+90 212 245 48 11"
    }),
    {
      address: "Hacıahmet, Kurtuluş Deresi Cd. No:63",
      postalCode: "34852",
      city: "Beyoğlu",
      state: "İstanbul",
      phone: "902122454811"
    }
  );
  assert.equal(normalizeTurkishPhone("+90 212 245 48 11"), "902122454811");
});

test("normalizeAddressInfo accepts address-generator input field values", () => {
  assert.deepEqual(
    normalizeAddressInfo({
      address: "Hacıahmet, Kurtuluş Deresi Cd. No:63, 34852 Beyoğlu/İstanbul, Turkey",
      city: "Istanbul",
      postalCode: "34852",
      phone: "+90 212 245 48 11"
    }),
    {
      address: "Hacıahmet, Kurtuluş Deresi Cd. No:63",
      postalCode: "34852",
      city: "Beyoğlu",
      state: "İstanbul",
      phone: "902122454811"
    }
  );
});

test("hasCompleteAddressInfo requires a five digit postal code and numeric phone", () => {
  assert.equal(
    hasCompleteAddressInfo({
      address: "Street",
      postalCode: "06825",
      city: "Mamak",
      state: "Ankara",
      phone: "903124493641"
    }),
    true
  );
  assert.equal(
    hasCompleteAddressInfo({
      address: "Street",
      postalCode: "6825",
      city: "Mamak",
      state: "Ankara",
      phone: "903124493641"
    }),
    false
  );
});

test("selectDomainInfoFillRows selects A rows with valid domains and skips completed rows", () => {
  const keywordRows = [
    { rowNumber: 2, record: { "关键词": "a", "评级": "A", "域名推荐": "a.com" } },
    { rowNumber: 3, record: { "关键词": "b", "评级": "A", "域名推荐": DOMAIN_INFO_NOT_FOUND } },
    { rowNumber: 4, record: { "关键词": "c", "评级": "B", "域名推荐": "c.com" } },
    { rowNumber: 5, record: { "关键词": "d", "评级": "A", "域名推荐": "d.org" } }
  ];
  const domainInfoRows = [
    {
      rowNumber: 2,
      record: {
        "关键词": "d",
        "目标域名": "d.org",
        "公司名称": "d",
        "地址": "Street",
        "邮编": "34000",
        "城市": "Beyoğlu",
        "州": "İstanbul",
        "电话": "902122454811"
      }
    }
  ];
  const result = selectDomainInfoFillRows(keywordRows, domainInfoRows, { limit: 10 });
  assert.deepEqual(result.selected.map((row) => row.keyword), ["a"]);
  assert.deepEqual(result.skipped.map((row) => row.reason), [
    "invalid_domain_recommendation",
    "rating_not_a",
    "domain_info_complete"
  ]);
});

test("buildDomainInfoStatusUpdates reports completed info rows and total A domain research rows per task", () => {
  const taskTable = {
    rows: [
      { rowNumber: 2, record: { "词根": "generator", "关键词": "", "域名信息补全": "" } },
      { rowNumber: 3, record: { "词根": "calculator", "关键词": "", "域名信息补全": "" } }
    ]
  };
  const keywordTable = {
    rows: [
      { rowNumber: 10, record: { "词根": "generator", "关键词": "a", "评级": "A", "域名推荐": "a.com" } },
      { rowNumber: 11, record: { "词根": "generator", "关键词": "b", "评级": "A", "域名推荐": "b.org" } },
      { rowNumber: 12, record: { "词根": "generator", "关键词": "c", "评级": "A", "域名推荐": DOMAIN_INFO_NOT_FOUND } },
      { rowNumber: 13, record: { "词根": "generator", "关键词": "e", "评级": "A", "域名推荐": "" } },
      { rowNumber: 14, record: { "词根": "calculator", "关键词": "d", "评级": "B", "域名推荐": "d.com" } }
    ]
  };
  const domainInfoTable = {
    rows: [
      {
        rowNumber: 2,
        record: {
          "关键词": "a",
          "目标域名": "a.com",
          "公司名称": "a",
          "地址": "Street",
          "邮编": "34000",
          "城市": "Beyoğlu",
          "州": "İstanbul",
          "电话": "902122454811"
        }
      }
    ]
  };
  const updates = buildDomainInfoStatusUpdates(taskTable, keywordTable, domainInfoTable);
  assert.equal(updates[0].value, "已完成1个，总数4个");
  assert.equal(updates[1].value, "");
});

test("buildDomainInfoStatusUpdates can limit new status rows to touched tasks", () => {
  const taskTable = {
    rows: [
      { rowNumber: 2, record: { "词根": "generator", "关键词": "", "域名信息补全": "" } },
      { rowNumber: 3, record: { "词根": "calculator", "关键词": "", "域名信息补全": "" } },
      { rowNumber: 4, record: { "词根": "checker", "关键词": "", "域名信息补全": "已完成0个，总数1个" } }
    ]
  };
  const keywordTable = {
    rows: [
      { rowNumber: 10, record: { "词根": "generator", "关键词": "a", "评级": "A", "域名推荐": "a.com" } },
      { rowNumber: 11, record: { "词根": "calculator", "关键词": "b", "评级": "A", "域名推荐": "b.com" } },
      { rowNumber: 12, record: { "词根": "checker", "关键词": "c", "评级": "A", "域名推荐": "c.com" } }
    ]
  };
  const domainInfoTable = { rows: [] };
  const updates = buildDomainInfoStatusUpdates(taskTable, keywordTable, domainInfoTable, {
    touchedKeywordRows: [keywordTable.rows[0]]
  });
  assert.deepEqual(updates.map((row) => row.root), ["generator", "checker"]);
});
