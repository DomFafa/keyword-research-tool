export const WORKSPACE_BUSINESS_URL = "https://workspace.google.com/business/";
export const WORKSPACE_BUY_PATH = "/business/signup/buy";
export const WORKSPACE_BUY_CONFIRM_PATH = "/business/signup/buyconfirm";

export const WORKSPACE_PAGE_STATES = {
  LANDING: "landing",
  WELCOME: "welcome",
  CONTACT: "contact",
  SIGNUP_TYPE_SELECT: "signup_type_select",
  BUY: "buy",
  BUY_CONFIRM: "buy_confirm",
  UNKNOWN: "unknown"
};

export const GET_STARTED_LABELS = [
  "get started",
  "start now",
  "try it free",
  "başlayın",
  "başla",
  "başlayalım",
  "commencer",
  "empezar",
  "comenzar",
  "começar",
  "开始",
  "开始使用",
  "立即开始",
  "開始",
  "開始使用"
];

export const NEXT_LABELS = [
  "next",
  "continue",
  "ileri",
  "devam",
  "suivant",
  "siguiente",
  "próximo",
  "下一步",
  "继续",
  "下一步",
  "繼續"
];

export const NEW_DOMAIN_LABELS = [
  "get a new custom domain",
  "buy a new domain",
  "new custom domain",
  "yeni özel alan adı",
  "yeni alan adı",
  "nouveau domaine",
  "nuevo dominio",
  "新しいドメイン",
  "新的自定义域名",
  "购买新域名",
  "新的自訂網域"
];

export const CONTINUE_METHOD_LABELS = [
  "continue with this method",
  "continue",
  "bu yöntemle devam et",
  "devam",
  "continuer avec cette méthode",
  "continuar con este método",
  "使用此方式继续",
  "繼續使用此方法"
];

export function normalizeUiText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function detectWorkspacePageState(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return WORKSPACE_PAGE_STATES.UNKNOWN;
  }

  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  if (path === WORKSPACE_BUY_PATH) {
    return WORKSPACE_PAGE_STATES.BUY;
  }
  if (path === WORKSPACE_BUY_CONFIRM_PATH) {
    return WORKSPACE_PAGE_STATES.BUY_CONFIRM;
  }
  if (path === "/business/signup/signuptypeselect") {
    return WORKSPACE_PAGE_STATES.SIGNUP_TYPE_SELECT;
  }
  if (path === "/business/signup/contact") {
    return WORKSPACE_PAGE_STATES.CONTACT;
  }
  if (path === "/business/signup/welcome") {
    return WORKSPACE_PAGE_STATES.WELCOME;
  }
  if (path === "/business") {
    return WORKSPACE_PAGE_STATES.LANDING;
  }
  return WORKSPACE_PAGE_STATES.UNKNOWN;
}

export function isWorkspaceBuyPage(url) {
  return detectWorkspacePageState(url) === WORKSPACE_PAGE_STATES.BUY;
}

export function includesAnyLabel(text, labels) {
  const normalized = normalizeUiText(text);
  return labels.some((label) => normalized.includes(normalizeUiText(label)));
}

export function buildWorkspaceSnapshotExpression() {
  return `(() => {
    const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const path = location.pathname.replace(/\\/+$/, "") || "/";
    let state = "unknown";
    if (path === "/business/signup/buy") state = "buy";
    else if (path === "/business/signup/buyconfirm") state = "buy_confirm";
    else if (path === "/business/signup/signuptypeselect") state = "signup_type_select";
    else if (path === "/business/signup/contact") state = "contact";
    else if (path === "/business/signup/welcome") state = "welcome";
    else if (path === "/business") state = "landing";
    const businessInput = document.querySelector("#ucc-0, input[aria-label*='Business' i], input[type='text']");
    const checkedEmployee = document.querySelector("input[type='radio'][value='1']:checked, #c4:checked");
    const regionText = [...document.querySelectorAll("[role='combobox'], [aria-haspopup='listbox'], .rHGeGc-aPP78e")]
      .map((el) => clean(el.innerText || el.textContent || el.getAttribute("aria-label")))
      .filter(Boolean)
      .join(" | ");
    return {
      url: location.href,
      path,
      state,
      title: document.title,
      bodyText: clean(document.body?.innerText).slice(0, 3000),
      businessName: clean(businessInput?.value),
      employeeJustYou: Boolean(checkedEmployee),
      regionText
    };
  })()`;
}
