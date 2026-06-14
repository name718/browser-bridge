export let isAgentSessionActive = false;

export async function broadcastAgentSessionStatus(active: boolean) {
  isAgentSessionActive = active;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'agent_session_status',
        active: isAgentSessionActive
      }).catch(() => {});
    }
  }
}
