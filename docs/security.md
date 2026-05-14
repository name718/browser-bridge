# 安全说明

浏览器桥接使用本地 Chrome 插件作为浏览器权限入口。MCP 服务不会直接读取 Cookie，也不会执行任意 JavaScript。

## 默认行为

- 只支持 `http` 和 `https` 页面。
- 默认允许列表是 `http://*` 和 `https://*`。
- 默认拒绝列表为空。
- 高风险点击会被拦截，例如删除、支付、提交、发送、发布、审批等。
- 默认允许截图。

## 插件弹窗配置

打开插件弹窗后可以直接配置：

- 桥接地址。
- 允许列表。
- 拒绝列表。
- 高风险点击是否需要确认。
- 是否允许截图。
- 查看最近操作审计日志。

配置会保存到 `chrome.storage.local`。桥接地址保存后，插件会自动断开旧连接并连接新地址。

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

第一层安全机制会识别高风险 `browser_click` 请求，并要求用户在页面确认框中确认。用户取消时返回：

```text
USER_REJECTED
```

当前高风险关键词包括 delete、remove、pay、purchase、submit、send、publish、approve、reject，以及常见中文关键词。

当前版本使用页面内确认浮层，浮层会展示风险原因和当前页面 URL。

## 审计日志

插件会保存最近 100 条浏览器工具调用记录，包括：

- 时间。
- 工具名。
- 页面 URL。
- 成功或失败。
- 错误码。

审计日志不会记录截图内容、输入正文或 Cookie 等敏感内容。可以通过插件弹窗查看最近记录，也可以通过 MCP 工具 `browser_get_audit_log` 读取。
