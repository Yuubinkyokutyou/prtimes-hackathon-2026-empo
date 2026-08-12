"use strict";

const state = { bootstrap: null, selectedCompanyId: null };
const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  [
    "login-view", "dashboard-view", "account-list", "bootstrap-error",
    "retry-button", "back-button", "company-name", "recommendation-list",
    "own-releases", "loading", "toast",
  ].forEach((id) => { elements[toCamelCase(id)] = document.getElementById(id); });
  elements.retryButton.addEventListener("click", loadBootstrap);
  elements.backButton.addEventListener("click", showLogin);
  elements.toast.querySelector("button").addEventListener("click", hideToast);
  loadBootstrap();
});

async function loadBootstrap() {
  elements.bootstrapError.hidden = true;
  elements.accountList.innerHTML = '<div class="account-skeleton"></div><div class="account-skeleton"></div><div class="account-skeleton"></div>';
  try {
    state.bootstrap = await apiRequest("/api/bootstrap");
    const accounts = state.bootstrap.demo_accounts ?? state.bootstrap.companies ?? [];
    if (!accounts.length) throw new Error("ログインできるデモ企業がありません。");
    renderAccounts(accounts.slice(0, 6));
  } catch (error) {
    elements.accountList.innerHTML = "";
    elements.bootstrapError.querySelector("span").textContent = error.message;
    elements.bootstrapError.hidden = false;
  }
}

function renderAccounts(accounts) {
  elements.accountList.innerHTML = "";
  accounts.forEach((company, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "account-button";
    button.innerHTML = `
      <span class="company-avatar">${escapeHtml(String(company.name ?? company.company_name ?? "企").charAt(0))}</span>
      <span class="account-copy">
        <strong>${escapeHtml(company.name ?? company.company_name)}</strong>
        <small>${escapeHtml(company.industry ?? "業種未設定")}</small>
      </span>
      <span class="login-label">この企業で見る <i>→</i></span>`;
    button.style.setProperty("--delay", `${index * 45}ms`);
    button.addEventListener("click", () => loginAs(company.company_id));
    elements.accountList.append(button);
  });
}

async function loginAs(companyId) {
  state.selectedCompanyId = companyId;
  hideToast();
  elements.loading.hidden = false;
  try {
    const response = await apiRequest("/api/recommendations", {
      method: "POST",
      body: { company_id: companyId, limit: 3 },
    });
    renderDashboard(response);
    elements.loginView.hidden = true;
    elements.dashboardView.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.loading.hidden = true;
  }
}

function renderDashboard(data) {
  const company = data.company ?? {};
  elements.companyName.textContent = company.name ?? company.company_name ?? "企業名未設定";
  elements.ownReleases.innerHTML = "";

  (data.own_releases ?? []).forEach((release) => {
    const releaseUrl = validatedUrl(release.url);
    const article = document.createElement("article");
    article.innerHTML = `
      <strong>${escapeHtml(release.title)}</strong>
      ${releaseUrl ? `<a href="${escapeHtml(releaseUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(release.title)}を開く">↗</a>` : ""}`;
    elements.ownReleases.append(article);
  });

  elements.recommendationList.innerHTML = "";

  (data.recommendations ?? []).forEach((item) => {
    const reference = item.reference_release ?? {};
    const source = item.source_release ?? {};
    const referenceUrl = validatedUrl(reference.url);
    const article = document.createElement("article");
    article.className = "recommendation-card";
    article.innerHTML = `
      <div class="rank-block"><span>0${escapeHtml(item.rank)}</span></div>
      <div class="proposal-main">
        <div class="idea-equation">
          <div class="equation-source">
            <small>自社の過去PR</small>
            <strong>${escapeHtml(source.title)}</strong>
          </div>
          <span class="multiply" aria-label="掛け合わせる">×</span>
          <div class="equation-reference">
            <small>他社事例から見つけた切り口</small>
            <strong>${escapeHtml(item.pattern)}</strong>
            <p><b>${escapeHtml(reference.company_name)}</b>${escapeHtml(reference.title)}</p>
            ${referenceUrl ? `<a href="${escapeHtml(referenceUrl)}" target="_blank" rel="noopener noreferrer">参考リリースを見る ↗</a>` : ""}
          </div>
        </div>
        <div class="proposal-result">
          <span>掛け合わせると</span>
          <h3>${escapeHtml(item.proposal_title)}</h3>
          <p>${escapeHtml(item.angle)}</p>
        </div>
      </div>`;
    elements.recommendationList.append(article);
  });
}

function showLogin() {
  state.selectedCompanyId = null;
  elements.dashboardView.hidden = true;
  elements.loginView.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  elements.toast.querySelector("span").textContent = message || "処理に失敗しました。";
  elements.toast.hidden = false;
}

function hideToast() { elements.toast.hidden = true; }

async function apiRequest(path, options = {}) {
  const request = { method: options.method ?? "GET", headers: { Accept: "application/json" } };
  if (options.body !== undefined) {
    request.headers["Content-Type"] = "application/json";
    request.body = JSON.stringify(options.body);
  }
  let response;
  try { response = await fetch(path, request); }
  catch (_error) { throw new Error("サーバーに接続できません。起動状態を確認してください。"); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? `処理に失敗しました（${response.status}）。`);
  return data;
}

function validatedUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value), window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_error) { return ""; }
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function toCamelCase(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
