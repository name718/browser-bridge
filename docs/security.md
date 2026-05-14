# Security

Browser Bridge uses a local Chrome extension as the browser authority. The MCP server never reads cookies directly and does not execute arbitrary JavaScript.

## Defaults

- Only `http` and `https` pages are supported.
- Default allowlist is `http://*` and `https://*`.
- Default denylist is empty.
- High-risk click actions are blocked when their text, selector, or element id appears risky.
- Screenshot capture is enabled by default.

## Chrome Storage Config

The extension reads security settings from `chrome.storage.local`.

```js
chrome.storage.local.set({
  allowlist: ["https://example.com/*", "https://*.internal.example.com/*"],
  denylist: ["https://billing.example.com/*"],
  blockHighRiskActions: true,
  screenshotEnabled: true
});
```

Patterns support `*` wildcards. A URL is allowed only when it matches the allowlist and does not match the denylist.

## High-Risk Blocking

The first security layer blocks risky `browser_click` requests and returns:

```text
USER_CONFIRMATION_REQUIRED
```

Current risky patterns include delete, remove, pay, purchase, submit, send, publish, approve, reject, and common Chinese equivalents.

The current behavior is blocking-only. A later version should add an explicit user confirmation UI in the extension popup or an in-page overlay.

