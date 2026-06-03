import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { evaluate, navigateAndWait } from "./cdp.mjs";
import { sleep } from "./browser-actions.mjs";

const execFileAsync = promisify(execFile);

const BING_AUTH_URL = "https://www.bing.com/webmaster/tools/contentremovalform/ShowAnonymousPage";
const BING_WEBMASTER_HOME_URL = "https://www.bing.com/webmasters/";
const OUTLOOK_AUTH_ROOT = "/Volumes/NAZA/库/outlook-auth";
const OUTLOOK_AUTH_PYTHON = `${OUTLOOK_AUTH_ROOT}/.venv/bin/python`;

function hasCredentials(account = {}) {
  return Boolean(account.email && account.password);
}

async function pageSnapshot(cdp, sessionId) {
  return evaluate(
    cdp,
    sessionId,
    `(() => {
      const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      return {
        url: location.href.toLowerCase(),
        title: document.title.toLowerCase(),
        body: clean(document.body?.innerText || "").toLowerCase().slice(0, 2500)
      };
    })()`,
    10000
  ).catch(() => ({ url: "", title: "", body: "" }));
}

export async function detectBingAuthState(cdp, sessionId) {
  const { url, title, body } = await pageSnapshot(cdp, sessionId);

  if (/bing\.com\/webmasters?/i.test(url) && !/contentremovalform/i.test(url)) {
    return "bing_webmaster_loaded";
  }
  if (/contentremovalform/i.test(url)) {
    return "bing_login_select";
  }
  if (body.includes("looks good") || body.includes("is your info correct") || body.includes("security info still accurate")) {
    return "looks_good";
  }
  if (url.includes("fido") || url.includes("passkey") || title.includes("passkey") || title.includes("fido") ||
    ["passkey", "passkeys", "security key", "setting up your passkey", "sign in faster", "create a passkey", "通行密钥"].some((hint) => body.includes(hint))) {
    return "passkey";
  }
  if (body.includes("your account has been locked") || body.includes("account has been locked") || body.includes("ihr konto wurde gesperrt")) {
    return "account_locked";
  }
  if ([
    "bad user credential",
    "too many signin attempts",
    "your account or password is incorrect",
    "that password is incorrect",
    "password is incorrect",
    "account is locked",
    "sign-in was blocked",
    "try again later",
    "we've detected something unusual",
    "there was an issue looking up your account",
    "we couldn't find an account with that username",
    "密码不正确",
    "账号已锁定",
    "登录被阻止"
  ].some((hint) => body.includes(hint))) {
    return "login_error";
  }
  if (body.includes("that doesn't match the alternate email")) {
    return "security_email_error";
  }
  if (body.includes("授权成功") || body.includes("authorization successful")) {
    return "success";
  }
  if (url.includes("error=access_denied") || body.includes("user has denied access")) {
    return "oauth_access_denied";
  }
  const elementState = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const visible = (el) => Boolean(el && el.offsetParent !== null && !el.disabled);
      if (visible(document.querySelector("[data-testid='appConsentPrimaryButton']"))) return "consent";
      if (document.body?.innerText?.toLowerCase().includes("permissions requested") || document.body?.innerText?.toLowerCase().includes("wants to access")) return "consent";
      if (document.body?.innerText?.toLowerCase().includes("stay signed in") || document.body?.innerText?.includes("保持登录")) return "stay_signed";
      if (visible(document.querySelector("#codeEntry-0"))) return "verify_code_new";
      if (visible(document.querySelector("#proof-confirmation-email-input"))) return "verify_email_new";
      if (visible(document.querySelector("#iOttText"))) return "verify_code";
      if (visible(document.querySelector("#EmailAddress"))) return "security_email";
      if (visible(document.querySelector("#passwordEntry, #i0118, input[name='passwd']"))) return "login_password";
      if (visible(document.querySelector("#i0116, #usernameEntry, input[name='loginfmt']"))) return "login_email";
      return "";
    })()`,
    10000
  ).catch(() => "");
  if (elementState) return elementState;
  if (title.includes("protect your account") || body.includes("protect your account")) {
    return "security_email";
  }
  return "unknown";
}

async function clickFirstVisible(cdp, sessionId, targets, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const targets = ${JSON.stringify(targets)};
        const visible = (el) => Boolean(el && el.offsetParent !== null && !el.disabled);
        const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
        for (const target of targets) {
          let el = null;
          if (target.css) {
            el = document.querySelector(target.css);
          } else if (target.xpath) {
            el = document.evaluate(target.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          } else if (target.text) {
            const text = target.text.toLowerCase();
            el = [...document.querySelectorAll(target.selector || "button, a, input[type='submit'], [role='button']")]
              .find((item) => visible(item) && clean(item.innerText || item.value || item.textContent).toLowerCase().includes(text));
          }
          if (visible(el)) {
            el.scrollIntoView({ block: "center", inline: "center" });
            el.click();
            return { ok: true, target, text: clean(el.innerText || el.value || el.textContent) };
          }
        }
        return { ok: false };
      })()`,
      10000
    ).catch(() => ({ ok: false }));
    if (result.ok) return result;
    await sleep(500);
  }
  return { ok: false };
}

async function focusAndInsertText(cdp, sessionId, selectors, value, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const focused = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const selectors = ${JSON.stringify(selectors)};
        const visible = (el) => Boolean(el && el.offsetParent !== null && !el.disabled);
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (!visible(el)) continue;
          el.scrollIntoView({ block: "center", inline: "center" });
          el.focus();
          const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
          if (setter) setter.call(el, "");
          else el.value = "";
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
          return { ok: true, selector };
        }
        return { ok: false };
      })()`,
      10000
    ).catch(() => ({ ok: false }));
    if (focused.ok) {
      await cdp.send("Input.insertText", { text: String(value || "") }, sessionId);
      await evaluate(
        cdp,
        sessionId,
        `(() => {
          const el = document.activeElement;
          if (el) {
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return { ok: true, value: el.value || "" };
          }
          return { ok: false };
        })()`,
        5000
      ).catch(() => ({}));
      return focused;
    }
    await sleep(500);
  }
  return { ok: false };
}

async function pressEnter(cdp, sessionId) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13
  }, sessionId).catch(() => {});
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13
  }, sessionId).catch(() => {});
}

async function dismissPasskey(cdp, sessionId) {
  for (let i = 0; i < 3; i += 1) {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27
    }, sessionId).catch(() => {});
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27
    }, sessionId).catch(() => {});
    await sleep(700);
  }
  await clickFirstVisible(cdp, sessionId, [
    { css: "#iCancel" },
    { css: "#cancelLink" },
    { text: "cancel" },
    { text: "not now" },
    { text: "no thanks" }
  ], 3000);
}

async function getMicrosoftVerificationCode(recoverEmail) {
  if (!recoverEmail) return "";
  const python = process.env.BING_AUTH_PYTHON || OUTLOOK_AUTH_PYTHON;
  const code = [
    "import sys",
    `sys.path.insert(0, ${JSON.stringify(OUTLOOK_AUTH_ROOT)})`,
    "from precise_gmail_verification import PreciseGmailVerification",
    `code = PreciseGmailVerification().get_microsoft_verification_code(${JSON.stringify(recoverEmail)})`,
    "print(code or '')"
  ].join("; ");
  const { stdout } = await execFileAsync(python, ["-c", code], {
    cwd: OUTLOOK_AUTH_ROOT,
    timeout: 60000,
    maxBuffer: 1024 * 1024
  });
  const matches = String(stdout || "").match(/\\b\\d{6}\\b/g);
  return matches?.at(-1) || "";
}

async function submitCurrentForm(cdp, sessionId) {
  await pressEnter(cdp, sessionId);
  await sleep(800);
  await clickFirstVisible(cdp, sessionId, [
    { css: "#idSIButton9" },
    { css: "button[data-testid='primaryButton']" },
    { css: "button[type='submit']" },
    { text: "next" },
    { text: "sign in" },
    { text: "verify" },
    { text: "yes" }
  ], 2500);
  await sleep(3000);
}

async function handleVerificationCode(cdp, sessionId, recoverEmail, mode) {
  await sleep(5000);
  let code = await getMicrosoftVerificationCode(recoverEmail);
  if (!code) {
    await sleep(10000);
    code = await getMicrosoftVerificationCode(recoverEmail);
  }
  if (!code) {
    return false;
  }
  if (mode === "new") {
    for (let i = 0; i < Math.min(6, code.length); i += 1) {
      const focused = await focusAndInsertText(cdp, sessionId, [`#codeEntry-${i}`], code[i], 5000);
      if (!focused.ok) return false;
      await sleep(120);
    }
    await sleep(2000);
    await clickFirstVisible(cdp, sessionId, [
      { css: "button[data-testid='primaryButton']" },
      { text: "verify" }
    ], 3000);
    await sleep(5000);
    return true;
  }
  const filled = await focusAndInsertText(cdp, sessionId, ["#iOttText"], code, 10000);
  if (!filled.ok) return false;
  await submitCurrentForm(cdp, sessionId);
  return true;
}

async function fallbackToPassword(cdp, sessionId, account) {
  const clicked = await clickFirstVisible(cdp, sessionId, [
    { text: "use your password", selector: "span, div, button, a" },
    { xpath: "//*[@id='view']/div/span[2]/div/span" },
    { xpath: "//*[@id='view']/div/span[2]" }
  ], 5000);
  if (!clicked.ok) return "failed";
  await sleep(3000);
  const filled = await focusAndInsertText(cdp, sessionId, ["#passwordEntry", "#i0118", "input[name='passwd']"], account.password, 10000);
  if (!filled.ok) return "failed";
  await submitCurrentForm(cdp, sessionId);
  let state = await detectBingAuthState(cdp, sessionId);
  if (state !== "login_error" || !account.fallbackPassword) return state === "login_error" ? "incorrect_password" : "success";
  const retry = await focusAndInsertText(cdp, sessionId, ["#passwordEntry", "#i0118", "input[name='passwd']"], account.fallbackPassword, 10000);
  if (!retry.ok) return "incorrect_password";
  await submitCurrentForm(cdp, sessionId);
  state = await detectBingAuthState(cdp, sessionId);
  return state === "login_error" ? "incorrect_password" : "success";
}

export async function runBingWebmasterAuthFlow(cdp, sessionId, account, {
  maxRounds = 15,
  authOpenMaxAttempts = 3
} = {}) {
  if (!hasCredentials(account)) {
    return { ok: false, reason: "missing_bing_login_credentials" };
  }
  let primaryError = "";
  let authOpenAttempts = 0;
  const openAuthEntry = async () => {
    authOpenAttempts += 1;
    await navigateAndWait(cdp, sessionId, BING_AUTH_URL, 30000).catch(async () => {
      await sleep(5000);
    });
    await sleep(5000);
    return authOpenAttempts < authOpenMaxAttempts;
  };

  await openAuthEntry();
  for (let round = 1; round <= maxRounds; round += 1) {
    const state = await detectBingAuthState(cdp, sessionId);
    console.log(`  Bing auth state ${round}/${maxRounds}: ${state}`);
    if (state === "bing_webmaster_loaded" || state === "success") {
      return { ok: true, reason: primaryError };
    }
    if (state === "bing_login_select") {
      const clicked = await clickFirstVisible(cdp, sessionId, [
        { xpath: "//a[contains(@href, 'AuthorizeMicrosoft')]" },
        { text: "Microsoft", selector: "a, button" },
        { xpath: "//*[@id='multiLoginModel_1']/div/ul/li[1]/a" }
      ], 15000);
      if (!clicked.ok) {
        if (await openAuthEntry()) continue;
        return { ok: false, reason: "bing_auth_login_entry_not_found" };
      }
      await sleep(8000);
      if (await detectBingAuthState(cdp, sessionId) === "bing_login_select") {
        await navigateAndWait(cdp, sessionId, BING_WEBMASTER_HOME_URL, 30000).catch(async () => {
          await sleep(5000);
        });
      }
      continue;
    }
    if (state === "login_email") {
      const filled = await focusAndInsertText(cdp, sessionId, ["#i0116", "input[name='loginfmt']", "#usernameEntry"], account.email, 10000);
      if (!filled.ok) return { ok: false, reason: "email_input_failed" };
      await submitCurrentForm(cdp, sessionId);
      continue;
    }
    if (state === "login_password") {
      const filled = await focusAndInsertText(cdp, sessionId, ["#passwordEntry", "#i0118", "input[name='passwd']"], account.password, 15000);
      if (!filled.ok) return { ok: false, reason: "password_input_failed" };
      await submitCurrentForm(cdp, sessionId);
      continue;
    }
    if (state === "security_email") {
      if (!account.recoverEmail) return { ok: false, reason: "recover_email_missing" };
      const filled = await focusAndInsertText(cdp, sessionId, ["#EmailAddress"], account.recoverEmail, 10000);
      if (!filled.ok) return { ok: false, reason: "recover_email_input_failed" };
      await submitCurrentForm(cdp, sessionId);
      continue;
    }
    if (state === "verify_email_new") {
      if (!account.recoverEmail) return { ok: false, reason: "recover_email_missing" };
      const filled = await focusAndInsertText(cdp, sessionId, ["#proof-confirmation-email-input"], account.recoverEmail, 10000);
      if (!filled.ok) return { ok: false, reason: "new_recover_email_input_failed" };
      await clickFirstVisible(cdp, sessionId, [
        { text: "send code", selector: "button" },
        { css: "button[data-testid='primaryButton']" },
        { css: "button[type='submit']" }
      ], 5000);
      await sleep(6000);
      continue;
    }
    if (state === "verify_code") {
      if (!await handleVerificationCode(cdp, sessionId, account.recoverEmail, "old")) {
        return { ok: false, reason: "verification_code_failed" };
      }
      continue;
    }
    if (state === "verify_code_new") {
      if (!await handleVerificationCode(cdp, sessionId, account.recoverEmail, "new")) {
        return { ok: false, reason: "new_verification_code_failed" };
      }
      continue;
    }
    if (state === "passkey") {
      await dismissPasskey(cdp, sessionId);
      await sleep(3000);
      if (await detectBingAuthState(cdp, sessionId) === "passkey") {
        await openAuthEntry();
      }
      continue;
    }
    if (state === "looks_good") {
      await clickFirstVisible(cdp, sessionId, [
        { css: "#iLooksGood" },
        { css: "#idSIButton9" },
        { css: "button[data-testid='primaryButton']" },
        { text: "looks good" }
      ], 10000);
      await sleep(5000);
      continue;
    }
    if (state === "stay_signed") {
      await clickFirstVisible(cdp, sessionId, [
        { css: "#idSIButton9" },
        { css: "button[data-testid='primaryButton']" },
        { text: "yes" }
      ], 5000);
      await sleep(5000);
      continue;
    }
    if (state === "consent") {
      const clicked = await clickFirstVisible(cdp, sessionId, [
        { css: "[data-testid='appConsentPrimaryButton']" },
        { text: "accept" },
        { text: "yes" },
        { text: "allow" }
      ], 10000);
      if (!clicked.ok) return { ok: false, reason: "consent_accept_not_found" };
      await sleep(8000);
      continue;
    }
    if (state === "security_email_error") {
      primaryError = "security_email_error|";
      const result = await fallbackToPassword(cdp, sessionId, account);
      if (result === "failed" || result === "incorrect_password") {
        return { ok: false, reason: `${primaryError}${result}` };
      }
      continue;
    }
    if (state === "account_locked") return { ok: false, reason: "account_locked" };
    if (state === "login_error") return { ok: false, reason: "login_error" };
    if (state === "oauth_access_denied") return { ok: false, reason: "oauth_access_denied" };

    await sleep(3000);
  }
  return { ok: false, reason: `auth_max_rounds_${maxRounds}` };
}
