type PopupStatus = {
  connected: boolean;
  bridgeUrl: string;
  security?: {
    allowlist: string[];
    denylist: string[];
    blockHighRiskActions: boolean;
    screenshotEnabled: boolean;
  };
};

void chrome.runtime.sendMessage({ type: "popup_status" }, (status: PopupStatus) => {
  const statusText = document.querySelector("#status");
  const bridgeUrl = document.querySelector("#bridge-url");
  const allowlist = document.querySelector<HTMLTextAreaElement>("#allowlist");
  const denylist = document.querySelector<HTMLTextAreaElement>("#denylist");
  const blockRisk = document.querySelector<HTMLInputElement>("#block-risk");
  const screenshotEnabled = document.querySelector<HTMLInputElement>("#screenshot-enabled");
  const dot = document.querySelector("#status-dot");

  if (!statusText || !bridgeUrl || !allowlist || !denylist || !blockRisk || !screenshotEnabled || !dot) {
    return;
  }

  statusText.textContent = status?.connected ? "已连接" : "未连接";
  bridgeUrl.textContent = status?.bridgeUrl ?? "-";
  allowlist.value = status?.security?.allowlist.join("\n") ?? "http://*\nhttps://*";
  denylist.value = status?.security?.denylist.join("\n") ?? "";
  blockRisk.checked = status?.security?.blockHighRiskActions ?? true;
  screenshotEnabled.checked = status?.security?.screenshotEnabled ?? true;
  dot.classList.toggle("connected", Boolean(status?.connected));
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
