import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildHubstudioApiProxyPayload,
  cacheHubstudioBrowserSession,
  cacheHubstudioEnvironment,
  evaluateHubstudioProxyDirectGuard,
  extractIpAddress,
  forgetHubstudioBrowserSession,
  hasHubstudioApiProxyConfig,
  readCachedHubstudioBrowserSession,
  readCachedHubstudioEnvironment,
  resolveHubstudioProxyRegion,
  waitForHubstudioDebuggerEndpoint
} from "../src/lib/hubstudio-api.mjs";

function tempPath(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hubstudio-api-")), name);
}

test("hubstudio fingerprint cache stores serial to containerCode mapping", () => {
  const cachePath = tempPath("fingerprints.json");

  assert.equal(cacheHubstudioEnvironment({
    serialNumber: 33,
    containerCode: 991432192,
    containerName: "D31",
    coreVersion: 140
  }, cachePath), true);

  assert.deepEqual(readCachedHubstudioEnvironment(33, cachePath), {
    serialNumber: 33,
    containerCode: "991432192",
    containerName: "D31",
    coreVersion: 140
  });
  assert.equal(readCachedHubstudioEnvironment(34, cachePath), null);
});

test("hubstudio browser session cache can be forgotten after stopping a fingerprint", () => {
  const cachePath = tempPath("sessions.json");

  assert.equal(cacheHubstudioBrowserSession({
    serialNumber: 33,
    containerCode: 991432192,
    debuggingPort: 55331
  }, cachePath), true);

  assert.equal(readCachedHubstudioBrowserSession(991432192, cachePath).debuggingPort, 55331);
  assert.equal(forgetHubstudioBrowserSession(991432192, cachePath), true);
  assert.equal(readCachedHubstudioBrowserSession(991432192, cachePath), null);
});

test("waitForHubstudioDebuggerEndpoint polls until endpoint is available", async () => {
  let calls = 0;
  const endpoint = await waitForHubstudioDebuggerEndpoint({
    debuggingPort: 55331,
    timeoutMs: 100,
    intervalMs: 1,
    readEndpoint(port) {
      calls += 1;
      return calls >= 3 ? `ws://127.0.0.1:${port}/devtools/browser/test` : "";
    }
  });

  assert.equal(endpoint, "ws://127.0.0.1:55331/devtools/browser/test");
  assert.equal(calls, 3);
});

test("buildHubstudioApiProxyPayload configures API proxy extraction before opening", () => {
  const payload = buildHubstudioApiProxyPayload({
    config: {
      proxy: {
        apiKey: "secret-key",
        apiUrlTemplate: "https://proxy.example.test/get?api_key={api_key}&region={region}",
        proxyTypeName: "Socks5_通用api",
        ipGetRuleType: 2
      }
    },
    containerCode: 991432192,
    containerName: "D31",
    region: "us-west-2"
  });

  assert.deepEqual(payload, {
    containerCode: "991432192",
    containerName: "D31",
    asDynamicType: 2,
    proxyTypeName: "Socks5_通用api",
    ipGetRuleType: 2,
    linkCode: "https://proxy.example.test/get?api_key=secret-key&region=us-west-2",
    remark: "auto-updated-to-api-proxy; region=us-west-2"
  });
});

test("hasHubstudioApiProxyConfig requires a proxy key or link code", () => {
  assert.equal(hasHubstudioApiProxyConfig({ proxy: { enabled: true, apiKey: "x" } }), true);
  assert.equal(hasHubstudioApiProxyConfig({ proxy: { enabled: true, linkCode: "https://proxy.example.test" } }), true);
  assert.equal(hasHubstudioApiProxyConfig({ proxy: { enabled: false, apiKey: "x" } }), false);
  assert.equal(hasHubstudioApiProxyConfig({ proxy: { enabled: true } }), false);
});

test("resolveHubstudioProxyRegion maps Feishu region text to proxy regions", () => {
  assert.equal(resolveHubstudioProxyRegion("弗吉尼亚", "us-west-2"), "us-east-1");
  assert.equal(resolveHubstudioProxyRegion("California account", "us-east-1"), "us-west-1");
  assert.equal(resolveHubstudioProxyRegion("", "us-east-2"), "us-east-2");
});

test("extractIpAddress reads JSON and plain IP responses", () => {
  assert.equal(extractIpAddress('{"ip":"203.0.113.10"}'), "203.0.113.10");
  assert.equal(extractIpAddress("Current IP: 198.51.100.7"), "198.51.100.7");
});

test("evaluateHubstudioProxyDirectGuard switches on suspected local direct connection", () => {
  assert.deepEqual(evaluateHubstudioProxyDirectGuard({
    hostIp: "198.51.100.1",
    browserIp: "198.51.100.1"
  }), {
    ok: false,
    shouldSwitch: true,
    message: "代理异常：疑似本地直连，HubStudio 出口 IP 与本机一致 (198.51.100.1)"
  });
  assert.equal(evaluateHubstudioProxyDirectGuard({
    hostIp: "198.51.100.1",
    browserIp: "198.51.100.2"
  }).ok, true);
});
