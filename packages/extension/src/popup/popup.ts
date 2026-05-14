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
  const allowlist = document.querySelector("#allowlist");
  const denylist = document.querySelector("#denylist");
  const dot = document.querySelector("#status-dot");

  if (!statusText || !bridgeUrl || !allowlist || !denylist || !dot) {
    return;
  }

  statusText.textContent = status?.connected ? "已连接" : "未连接";
  bridgeUrl.textContent = status?.bridgeUrl ?? "-";
  allowlist.textContent = status?.security?.allowlist.join(", ") ?? "-";
  denylist.textContent = status?.security?.denylist.join(", ") || "-";
  dot.classList.toggle("connected", Boolean(status?.connected));
});
