type PopupStatus = {
  connected: boolean;
  bridgeUrl: string;
  lastError?: string;
  readyState?: string;
  security?: {
    allowlist: string[];
    denylist: string[];
    blockHighRiskActions: boolean;
    screenshotEnabled: boolean;
  };
  audit?: {
    entries: Array<{
      at: string;
      tool: string;
      url?: string;
      ok: boolean;
      errorCode?: string;
    }>;
  };
};

void refreshStatus();
window.setInterval(refreshStatus, 1000);

function refreshStatus(): void {
  chrome.runtime.sendMessage({ type: "popup_status" }, (status: PopupStatus) => {
    renderStatus(status);
  });
}

function renderStatus(status: PopupStatus): void {
  const statusText = document.querySelector("#status");
  const bridgeUrl = document.querySelector<HTMLInputElement>("#bridge-url");
  const allowlist = document.querySelector<HTMLTextAreaElement>("#allowlist");
  const denylist = document.querySelector<HTMLTextAreaElement>("#denylist");
  const blockRisk = document.querySelector<HTMLInputElement>("#block-risk");
  const screenshotEnabled = document.querySelector<HTMLInputElement>("#screenshot-enabled");
  const auditLog = document.querySelector("#audit-log");
  const dot = document.querySelector("#status-dot");
  const diagnostics = document.querySelector("#diagnostics");

  if (!statusText || !bridgeUrl || !allowlist || !denylist || !blockRisk || !screenshotEnabled || !auditLog || !dot || !diagnostics) {
    return;
  }

  statusText.textContent = status?.connected ? "已连接" : "未连接";
  diagnostics.textContent = renderDiagnostics(status);
  setValueIfIdle(bridgeUrl, status?.bridgeUrl ?? "ws://127.0.0.1:17321");
  setValueIfIdle(allowlist, status?.security?.allowlist.join("\n") ?? "http://*\nhttps://*");
  setValueIfIdle(denylist, status?.security?.denylist.join("\n") ?? "");
  blockRisk.checked = status?.security?.blockHighRiskActions ?? true;
  screenshotEnabled.checked = status?.security?.screenshotEnabled ?? true;
  dot.classList.toggle("connected", Boolean(status?.connected));
  auditLog.replaceChildren(...(status?.audit?.entries ?? []).map(renderAuditItem));
}

document.querySelector("#bridge-form")?.addEventListener("submit", (event) => {
  event.preventDefault();

  const bridgeUrl = document.querySelector<HTMLInputElement>("#bridge-url");
  const saveStatus = document.querySelector("#bridge-save-status");
  if (!bridgeUrl || !saveStatus) {
    return;
  }

  chrome.runtime.sendMessage({
    type: "popup_save_bridge",
    bridgeUrl: bridgeUrl.value
  }, (response) => {
    if (response?.bridgeUrl) {
      bridgeUrl.value = response.bridgeUrl;
    }
    saveStatus.textContent = "已保存，正在重连";
    window.setTimeout(() => {
      saveStatus.textContent = "";
    }, 1500);
  });
});

document.querySelector("#security-form")?.addEventListener("submit", (event) => {
  event.preventDefault();

  const allowlist = document.querySelector<HTMLTextAreaElement>("#allowlist");
  const denylist = document.querySelector<HTMLTextAreaElement>("#denylist");
  const blockRisk = document.querySelector<HTMLInputElement>("#block-risk");
  const screenshotEnabled = document.querySelector<HTMLInputElement>("#screenshot-enabled");
  const saveStatus = document.querySelector("#save-status");

  if (!allowlist || !denylist || !blockRisk || !screenshotEnabled || !saveStatus) {
    return;
  }

  chrome.runtime.sendMessage({
    type: "popup_save_security",
    security: {
      allowlist: parseLines(allowlist.value),
      denylist: parseLines(denylist.value),
      blockHighRiskActions: blockRisk.checked,
      screenshotEnabled: screenshotEnabled.checked
    }
  }, () => {
    saveStatus.textContent = "已保存";
    window.setTimeout(() => {
      saveStatus.textContent = "";
    }, 1500);
  });
});

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function setValueIfIdle(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (document.activeElement !== element) {
    element.value = value;
  }
}

function renderAuditItem(entry: NonNullable<PopupStatus["audit"]>["entries"][number]): HTMLLIElement {
  const item = document.createElement("li");
  const time = new Date(entry.at).toLocaleTimeString();
  item.textContent = `${time} ${entry.ok ? "成功" : "失败"} ${entry.tool}${entry.errorCode ? ` (${entry.errorCode})` : ""}`;
  item.title = entry.url ?? "";
  return item;
}

function renderDiagnostics(status?: PopupStatus): string {
  if (!status) {
    return "无法读取插件状态，请打开 chrome://extensions 查看错误。";
  }
  if (status.connected) {
    return `连接状态：${status.readyState ?? "OPEN"}`;
  }
  const state = status.readyState ? `连接状态：${status.readyState}` : "连接状态：未知";
  return status.lastError ? `${state}；${status.lastError}` : state;
}
