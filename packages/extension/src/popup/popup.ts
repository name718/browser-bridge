type PopupStatus = {
  connected: boolean;
  bridgeUrl: string;
};

void chrome.runtime.sendMessage({ type: "popup_status" }, (status: PopupStatus) => {
  const statusText = document.querySelector("#status");
  const bridgeUrl = document.querySelector("#bridge-url");
  const dot = document.querySelector("#status-dot");

  if (!statusText || !bridgeUrl || !dot) {
    return;
  }

  statusText.textContent = status?.connected ? "Connected" : "Disconnected";
  bridgeUrl.textContent = status?.bridgeUrl ?? "-";
  dot.classList.toggle("connected", Boolean(status?.connected));
});

