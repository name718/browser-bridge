# 安全说明

浏览器桥接使用本地 Chrome 插件作为浏览器权限入口。MCP 服务不会直接读取 Cookie，也不会执行任意 JavaScript。

## 默认行为

- 只支持 `http` 和 `https` 页面。
- 默认允许列表是 `http://*` 和 `https://*`。
- 默认拒绝列表为空。
- 高风险点击会被拦截，例如删除、支付、提交、发送、发布、审批等。
- 默认允许截图。

## Chrome 存储配置

插件会从 `chrome.storage.local` 读取安全配置：

```js
chrome.storage.local.set({
  allowlist: ["https://example.com/*", "https://*.internal.example.com/*"],
  denylist: ["https://billing.example.com/*"],
  blockHighRiskActions: true,
  screenshotEnabled: true
});
```

匹配规则支持 `*` 通配符。页面 URL 必须命中允许列表，并且不能命中拒绝列表。

## 高风险拦截

第一层安全机制会拦截高风险 `browser_click` 请求，并返回：

```text
USER_CONFIRMATION_REQUIRED
```

当前高风险关键词包括 delete、remove、pay、purchase、submit、send、publish、approve、reject，以及常见中文关键词。

当前版本只做拦截，不弹确认框。后续版本应在插件弹窗或页面内浮层中加入明确的用户确认流程。
