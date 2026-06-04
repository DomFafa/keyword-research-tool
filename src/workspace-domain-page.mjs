#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { readArg } from "./lib/args.mjs";
import {
  attachChromePage,
  CdpClient,
  createChromePage,
  detachChromePage,
  evaluate,
  navigateAndWait,
  readChromeWebSocketEndpoint
} from "./lib/cdp.mjs";
import {
  ensureChromeProfileTargetWithCdp,
  findChromeProfile
} from "./lib/chrome-profiles.mjs";
import {
  DEFAULT_SHEET_URL,
  getRequiredValueByAliases
} from "./lib/tool-config.mjs";
import {
  getSpreadsheetId,
  readSheetInSession
} from "./lib/google-sheet.mjs";
import { sleep } from "./lib/browser-actions.mjs";
import {
  buildWorkspaceSnapshotExpression,
  GET_STARTED_LABELS,
  NEXT_LABELS,
  WORKSPACE_BUSINESS_URL,
  WORKSPACE_PAGE_STATES
} from "./lib/workspace-domain-page.mjs";

const DEFAULT_BUSINESS_NAME = "compound interest calculator";
const DEFAULT_REGION = "Türkiye";
const DEFAULT_OUTPUT = "output/workspace-domain-page.json";

function json(value) {
  return JSON.stringify(value);
}

function pageActionExpression(source) {
  return `(() => {
    const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const lower = (value) => clean(value).toLowerCase();
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const clickElement = (el) => {
      el.scrollIntoView({ block: "center", inline: "center" });
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      el.click();
    };
    ${source}
  })()`;
}

async function maximizeChromeWindow(cdp, targetId) {
  const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId });
  await cdp.send("Browser.setWindowBounds", {
    windowId,
    bounds: { windowState: "maximized" }
  }).catch(async () => {
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        left: 0,
        top: 0,
        width: 1600,
        height: 1000
      }
    });
  });
}

async function readBrowserProfileFromToolAccount(cdp, {
  sheetUrl,
  accountSheetName
}) {
  let page;
  let closePage = false;
  try {
    const spreadsheetId = getSpreadsheetId(sheetUrl);
    const { targetInfos = [] } = await cdp.send("Target.getTargets");
    const existingSheetTarget = targetInfos.find(
      (target) =>
        target.type === "page" &&
        target.url.includes(`/spreadsheets/d/${spreadsheetId}`)
    );

    if (existingSheetTarget) {
      page = await attachChromePage(cdp, existingSheetTarget.targetId);
    } else {
      page = await createChromePage(cdp);
      closePage = true;
      await navigateAndWait(cdp, page.sessionId, "https://docs.google.com/", 30000);
    }

    const accountSheet = await readSheetInSession({
      cdp,
      sessionId: page.sessionId,
      sheetUrl,
      sheetName: accountSheetName,
      expectedHeaders: ["semrush账号"]
    });
    const toolAccount = accountSheet.rows[0] || {};
    const browserAccount = getRequiredValueByAliases(toolAccount, [
      "运行浏览器账号",
      "运行浏览器的账号"
    ]);
    return {
      accountSheet,
      toolAccount,
      browserAccount,
      chromeProfile: findChromeProfile(browserAccount)
    };
  } finally {
    if (page) {
      if (closePage) {
        await cdp.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
      } else {
        await detachChromePage(cdp, page.sessionId).catch(() => {});
      }
    }
  }
}

async function findExistingWorkspaceTarget(cdp) {
  const { targetInfos = [] } = await cdp.send("Target.getTargets");
  const workspaceTargets = targetInfos.filter(
    (target) =>
      target.type === "page" &&
      /^https:\/\/workspace\.google\.com\/business(?:\/|$)/.test(target.url || "")
  );
  return workspaceTargets.find((target) => target.url.includes("/business/signup/buy")) ||
    workspaceTargets[0] ||
    null;
}

async function openWorkspaceTarget(cdp, profile, startUrl) {
  const existing = await findExistingWorkspaceTarget(cdp);
  if (existing) {
    return existing;
  }

  return ensureChromeProfileTargetWithCdp(cdp, profile, startUrl, 30000);
}

async function snapshot(cdp, sessionId) {
  return evaluate(cdp, sessionId, buildWorkspaceSnapshotExpression(), 15000);
}

async function dismissCookieBanner(cdp, sessionId) {
  return evaluate(cdp, sessionId, pageActionExpression(`
    const labels = ["no thanks", "reject all", "agree", "accept all", "kabul", "hayır", "同意", "不用了"];
    const candidates = [...document.querySelectorAll("button, [role='button']")];
    const button = candidates.find((el) => visible(el) && labels.some((label) => lower(el.innerText || el.textContent).includes(label)));
    if (!button) return { ok: false, reason: "cookie banner not found" };
    clickElement(button);
    return { ok: true, text: clean(button.innerText || button.textContent) };
  `), 10000).catch(() => ({ ok: false }));
}

async function clickByLabels(cdp, sessionId, labels, {
  selector = "button, a, [role='button']",
  includes = true
} = {}) {
  const result = await evaluate(cdp, sessionId, pageActionExpression(`
    const labels = ${json(labels.map((label) => label.toLowerCase()))};
    const items = [...document.querySelectorAll(${json(selector)})];
    const match = items.find((el) => {
      if (!visible(el)) return false;
      const text = lower([el.innerText, el.textContent, el.getAttribute("aria-label")].filter(Boolean).join(" "));
      if (!text) return false;
      return labels.some((label) => ${includes ? "text.includes(label)" : "text === label"});
    });
    if (!match) return { ok: false, reason: "label not found", labels };
    clickElement(match);
    return { ok: true, text: clean(match.innerText || match.textContent || match.getAttribute("aria-label")) };
  `), 15000);
  if (!result?.ok) {
    throw new Error(result?.reason || `Unable to click labels: ${labels.join(", ")}`);
  }
  return result;
}

async function selectNewDomainMethod(cdp, sessionId) {
  const selected = await evaluate(cdp, sessionId, pageActionExpression(`
    const option = [...document.querySelectorAll("[role='option']")].find((el) => {
      const label = lower([el.getAttribute("aria-label"), el.innerText, el.textContent].filter(Boolean).join(" "));
      return visible(el) && label.includes("get a new custom domain");
    });
    if (!option) return { ok: false, reason: "new custom domain option not found" };
    option.focus();
    clickElement(option);
    option.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
    option.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter" }));
    return { ok: true, text: clean(option.getAttribute("aria-label") || option.innerText || option.textContent) };
  `), 10000);
  if (!selected?.ok) {
    throw new Error(selected?.reason || "Unable to select new custom domain");
  }

  const startedAt = Date.now();
  let clicked = null;
  while (Date.now() - startedAt < 15000) {
    clicked = await evaluate(cdp, sessionId, pageActionExpression(`
      const buttons = [...document.querySelectorAll("button")].filter(visible);
      const button = buttons.find((el) => {
        const text = lower([el.innerText, el.textContent, el.getAttribute("aria-label")].filter(Boolean).join(" "));
        return !el.disabled && el.getAttribute("aria-disabled") !== "true" && text.includes("continue");
      });
      if (!button) return { ok: false, reason: "enabled continue button not found" };
      clickElement(button);
      return { ok: true, text: clean(button.innerText || button.textContent || button.getAttribute("aria-label")) };
    `), 10000);
    if (clicked?.ok) {
      return { selected, clicked };
    }
    await sleep(500);
  }
  throw new Error(clicked?.reason || "Unable to continue with new domain method");
}

async function clickGetStarted(cdp, sessionId) {
  const result = await evaluate(cdp, sessionId, pageActionExpression(`
    const labels = ${json(GET_STARTED_LABELS.map((label) => label.toLowerCase()))};
    const candidates = [
      ...document.querySelectorAll("a[href*='/business/signup'], a[href*='signup'], button, [role='button']")
    ];
    const match = candidates.find((el) => {
      if (!visible(el)) return false;
      const href = String(el.getAttribute("href") || "");
      const text = lower(el.innerText || el.textContent || el.getAttribute("aria-label"));
      return href.includes("/business/signup") || labels.some((label) => text.includes(label));
    });
    if (!match) return { ok: false, reason: "get started not found" };
    clickElement(match);
    return { ok: true, text: clean(match.innerText || match.textContent || match.getAttribute("aria-label")), href: match.getAttribute("href") || "" };
  `), 15000);
  if (!result?.ok) {
    throw new Error(result?.reason || "Unable to click get started");
  }
  return result;
}

async function ensureWelcomeFields(cdp, sessionId, {
  businessName,
  region
}) {
  let result = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    result = await evaluate(cdp, sessionId, pageActionExpression(`
      const desiredName = ${json(businessName)};
      const desiredRegion = ${json(region)};
      const setValue = (el, value) => {
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };

      const businessInput = document.querySelector("#ucc-0, input[aria-label*='Business' i], input[type='text']");
      if (!businessInput) return { ok: false, reason: "business input not found" };
      if (clean(businessInput.value) !== desiredName) {
        setValue(businessInput, desiredName);
      }

      const employee = document.querySelector("#c4, input[type='radio'][value='1'], input[type='radio'][aria-label='One']");
      if (!employee) return { ok: false, reason: "employee radio not found" };
      if (!employee.checked) {
        clickElement(employee);
        employee.checked = true;
        employee.dispatchEvent(new Event("change", { bubbles: true }));
      }

      const bodyText = clean(document.body?.innerText);
      const regionAlreadySet = bodyText.includes(desiredRegion) || bodyText.includes("Turkey") || bodyText.includes("Türkiye");
      return {
        ok: true,
        businessName: clean(businessInput.value),
        employeeJustYou: Boolean(employee.checked),
        regionAlreadySet
      };
    `), 15000);
    if (result?.ok || result?.reason !== "business input not found") {
      break;
    }
    await sleep(500);
  }
  if (!result?.ok) {
    throw new Error(result?.reason || "Unable to fill welcome fields");
  }

  if (!result.regionAlreadySet) {
    await chooseRegion(cdp, sessionId, region);
  }
  return result;
}

async function chooseRegion(cdp, sessionId, region) {
  const opened = await evaluate(cdp, sessionId, pageActionExpression(`
    const candidates = [...document.querySelectorAll("[role='combobox'], [aria-haspopup='listbox'], .rHGeGc-aPP78e")];
    const match = candidates.find((el) => visible(el) && /region|country|ülke|bölge|国家|地區/i.test(clean(el.innerText || el.textContent || el.getAttribute("aria-label"))))
      || candidates.find((el) => visible(el));
    if (!match) return { ok: false, reason: "region selector not found" };
    clickElement(match);
    return { ok: true, text: clean(match.innerText || match.textContent || match.getAttribute("aria-label")) };
  `), 10000);
  if (!opened?.ok) {
    throw new Error(opened?.reason || "Unable to open region selector");
  }
  await sleep(800);
  const selected = await evaluate(cdp, sessionId, pageActionExpression(`
    const wanted = ${json(region.toLowerCase())};
    const aliases = [wanted, "turkey", "türkiye", "土耳其"];
    const candidates = [...document.querySelectorAll("[role='option'], [role='menuitem'], li, div")];
    const match = candidates.find((el) => visible(el) && aliases.some((alias) => lower(el.innerText || el.textContent).includes(alias)));
    if (!match) return { ok: false, reason: "region option not found" };
    clickElement(match);
    return { ok: true, text: clean(match.innerText || match.textContent) };
  `), 10000);
  if (!selected?.ok) {
    throw new Error(selected?.reason || "Unable to select region");
  }
  await sleep(500);
}

async function waitForStateChange(cdp, sessionId, previousState) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < 45000) {
    last = await snapshot(cdp, sessionId).catch(() => null);
    if (last?.state && last.state !== previousState) {
      return last;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for page state to change from ${previousState}. Last=${JSON.stringify(last)}`);
}

async function advanceWorkspacePage(cdp, page, options) {
  const history = [];
  for (let step = 1; step <= options.maxSteps; step += 1) {
    const current = await snapshot(cdp, page.sessionId);
    history.push({
      step,
      state: current.state,
      url: current.url,
      businessName: current.businessName,
      employeeJustYou: current.employeeJustYou,
      regionText: current.regionText
    });
    console.log(`[workspace] step ${step}: ${current.state} ${current.url}`);

    if (current.state === WORKSPACE_PAGE_STATES.BUY) {
      return { ok: true, state: current.state, url: current.url, history };
    }

    await dismissCookieBanner(cdp, page.sessionId);

    if (current.state === WORKSPACE_PAGE_STATES.LANDING) {
      await clickGetStarted(cdp, page.sessionId);
      await waitForStateChange(cdp, page.sessionId, current.state);
      continue;
    }

    if (current.state === WORKSPACE_PAGE_STATES.WELCOME) {
      await ensureWelcomeFields(cdp, page.sessionId, {
        businessName: options.businessName,
        region: options.region
      });
      await clickByLabels(cdp, page.sessionId, NEXT_LABELS);
      await waitForStateChange(cdp, page.sessionId, current.state);
      continue;
    }

    if (current.state === WORKSPACE_PAGE_STATES.CONTACT) {
      await clickByLabels(cdp, page.sessionId, NEXT_LABELS);
      await waitForStateChange(cdp, page.sessionId, current.state);
      continue;
    }

    if (current.state === WORKSPACE_PAGE_STATES.SIGNUP_TYPE_SELECT) {
      await selectNewDomainMethod(cdp, page.sessionId);
      await waitForStateChange(cdp, page.sessionId, current.state);
      continue;
    }

    await navigateAndWait(cdp, page.sessionId, WORKSPACE_BUSINESS_URL, 45000).catch(async () => {
      await sleep(3000);
    });
  }

  const current = await snapshot(cdp, page.sessionId).catch(() => null);
  return {
    ok: false,
    state: current?.state || WORKSPACE_PAGE_STATES.UNKNOWN,
    url: current?.url || "",
    history
  };
}

async function main() {
  const sheetUrl = readArg("sheet", process.env.GOOGLE_SHEET_URL || DEFAULT_SHEET_URL);
  const accountSheetName = readArg("account-sheet", "工具账号密码");
  const startUrl = readArg("start-url", WORKSPACE_BUSINESS_URL);
  const businessName = readArg("business-name", DEFAULT_BUSINESS_NAME);
  const region = readArg("region", DEFAULT_REGION);
  const output = readArg("out", DEFAULT_OUTPUT);
  const maxSteps = Number(readArg("max-steps", "8"));

  const cdp = new CdpClient(readChromeWebSocketEndpoint());
  await cdp.connect();

  let page;
  try {
    const config = await readBrowserProfileFromToolAccount(cdp, {
      sheetUrl,
      accountSheetName
    });
    console.log(`Browser account: ${config.browserAccount}`);
    console.log(`Chrome profile: ${config.chromeProfile.directory} (${config.chromeProfile.email || config.chromeProfile.name})`);

    const target = await openWorkspaceTarget(cdp, config.chromeProfile, startUrl);
    page = await attachChromePage(cdp, target.targetId);
    await maximizeChromeWindow(cdp, page.targetId);

    const result = await advanceWorkspacePage(cdp, page, {
      businessName,
      region,
      maxSteps: Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : 8
    });
    const payload = {
      source: {
        sheetUrl,
        accountSheetName,
        startUrl,
        businessName,
        region,
        readAt: new Date().toISOString()
      },
      browserAccount: config.browserAccount,
      chromeProfile: {
        directory: config.chromeProfile.directory,
        name: config.chromeProfile.name,
        email: config.chromeProfile.email
      },
      result
    };
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Wrote ${output}`);

    if (!result.ok) {
      throw new Error(`Workspace domain page was not reached. Final state=${result.state} url=${result.url}`);
    }
    console.log(`Workspace domain page ready: ${result.url}`);
  } finally {
    if (page) {
      await detachChromePage(cdp, page.sessionId).catch(() => {});
    }
    cdp.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
