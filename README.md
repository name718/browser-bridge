# Browser Bridge

<p align="center">
<b>让 AI 代理操控你的真实浏览器</b><br/>
通过 MCP 协议，连接 Claude Code / Cursor / Codex / Gemini CLI 到你的 Chrome 浏览器
</p>

<p align="center">
  <a href="#特性">特性</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#工具一览">工具一览</a> ·
  <a href="#安全机制">安全机制</a> ·
  <a href="#架构">架构</a>
</p>

---

## 为什么需要 Browser Bridge？

AI 代理擅长写代码，但面对浏览器就无能为力了。你可能遇到过这些场景：

- 让 AI 帮你测试网页，它只能读代码，不能点按钮
- 想让 AI 分析页面性能，但它拿不到真实数据
- 需要 AI 自动化填写表单、操作 SPA，但没有合适的接口
- 用 Puppeteer 跑无头浏览器？丢失登录态、Cookie、会话全得重新来

**Browser Bridge 解决这个问题**：AI 代理直接操控你已登录的真实 Chrome，保留所有 Cookie、Session 和认证状态，无需任何额外配置。

## 特性

### 页面读取 — 多层级，按需选择

| 工具 | 场景 | Token 成本 |
|---|---|---|
| `browser_get_page_text` | 提取可见文本 | 低 |
| `browser_capture_page` | 智能降级：PDF → 截图 → DOM | 自适应 |
| `browser_pdf` | 导出完整 PDF（类 Cmd+P） | 中 |
| `browser_screenshot` | 可视区域截图 | 中 |
| `browser_get_interactives` | 仅获取可交互元素 | 低 |
| `browser_get_page_snapshot` | 全量页面快照 | 高 |

### 元素交互 — 智能定位，精准操作

```
// 一行搞定：找到搜索框并输入
browser_find_and_type({ text: "AI Agent", placeholder: "Search" })

// 意图式操作：AI 只需说"点击登录按钮"
browser_act({ action: "click", target: "登录" })

// 批量填写表单
browser_fill_form({ fields: [
  { placeholder: "邮箱", value: "user@example.com" },
  { placeholder: "密码", value: "****" }
]})
```

### 多步骤自动化

```json
browser_run_steps({
  steps: [
    { "action": "open", "url": "https://example.com" },
    { "action": "click", "text": "登录" },
    { "action": "type", "placeholder": "邮箱", "value": "user@example.com" },
    { "action": "click", "text": "提交" },
    { "action": "assertText", "contains": "欢迎回来" },
    { "action": "screenshot" }
  ]
})
```

### 自定义 JS 执行

```json
browser_evaluate({ expression: "window.__vm__.$data.user.name" })
browser_evaluate({ expression: "JSON.stringify(performance.getEntriesByType('navigation')[0])" })
```

### CDP 深度分析

```json
// 一次性命令
browser_cdp({ method: "Performance.getMetrics" })
browser_cdp({ method: "DOM.getDocument", params: { depth: 2 } })

// 事件会话：抓取 3 秒内所有网络请求
browser_cdp_session({ enable: ["Network"], durationMs: 3000 })

// CPU Profiling
browser_cdp_session({ enable: ["Profiler"], durationMs: 5000 })
```

## 工具一览

共 **36 个 MCP 工具**，分为 10 大类：

| 类别 | 工具 | 说明 |
|---|---|---|
| **连接** | `browser_use` `browser_status` | 激活和状态检查 |
| **标签页** | `browser_list_tabs` `browser_open_url` `browser_activate_tab` `browser_get_active_tab` | 标签页管理 |
| **页面读取** | `browser_get_page_text` `browser_get_page_snapshot` `browser_get_interactives` `browser_get_links` `browser_get_selected_text` `browser_capture_page` | 多层级内容获取 |
| **截图/导出** | `browser_screenshot` `browser_save_screenshot` `browser_pdf` `browser_save_pdf` | 视觉捕获 |
| **元素查找** | `browser_find` `browser_find_and_click` `browser_find_and_type` | 智能元素定位 |
| **元素操作** | `browser_click` `browser_type` `browser_clear` `browser_hover` `browser_press_key` `browser_fill_form` `browser_scroll` `browser_wait_for` `browser_assert_text` | 交互操作 |
| **脚本执行** | `browser_evaluate` | 自定义 JS 执行 |
| **CDP** | `browser_cdp` `browser_cdp_session` | Chrome DevTools Protocol |
| **性能分析** | `browser_responsive` `browser_network_analysis` | 响应式测试 + 网络分析 |
| **自动化** | `browser_run_steps` `browser_get_audit_log` | 多步骤流程 + 审计 |

## 快速开始

### 1. 安装依赖

```bash
pnpm install
pnpm build
```

### 2. 加载 Chrome 插件

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `packages/extension/dist`

### 3. 配置 MCP 客户端

在你的 MCP 客户端（Claude Code、Cursor 等）中添加：

```json
{
  "mcpServers": {
    "browser-bridge": {
      "command": "node",
      "args": ["<项目路径>/packages/mcp-server/dist/index.js"],
      "env": {
        "BROWSER_BRIDGE_PORT": "17321"
      }
    }
  }
}
```

### 4. 开始使用

AI 代理首次调用时会自动启动 daemon。在 Chrome 插件弹窗中确认连接状态为「已连接」，然后：

```
Agent: 用 browser_use 激活浏览器工具
Agent: 用 browser_open_url 打开目标页面
Agent: 用 browser_capture_page 智能获取页面内容
Agent: 用 browser_evaluate 读取 window.__vm__ 数据
Agent: 用 browser_cdp 获取 Performance 指标
Agent: 分析并输出结果
```

## 安全机制

| 层级 | 机制 |
|---|---|
| **域名控制** | 白名单 / 黑名单配置 |
| **高风险确认** | 删除、支付、提交等操作弹出页面内确认浮层 |
| **密码保护** | 密码字段值永不返回 |
| **审计日志** | 每次操作记录到本地日志 |
| **截图开关** | 可禁用截图功能 |
| **PDF 开关** | 可禁用 PDF 导出 |
| **URL 限制** | `chrome://`、`about:` 等页面自动拒绝 |

## 架构

```
┌─────────────────┐     stdio      ┌──────────────────┐   WebSocket   ┌─────────────────┐
│   AI Agent      │ ──────────────→│   MCP Server     │──────────────→│  Chrome 插件     │
│ (Claude Code)   │                │  + Daemon        │               │  (Manifest V3)  │
│                 │←────────────── │                  │←──────────────│                 │
└─────────────────┘   JSON 响应    └──────────────────┘   Bridge响应  └─────────────────┘
                                                                           │
                                                                           ▼
                                                                    ┌─────────────┐
                                                                    │  真实浏览器  │
                                                                    │  (你的 Chrome)│
                                                                    └─────────────┘
```

- **MCP Server** — 标准 stdio MCP 协议，所有 AI 客户端兼容
- **Daemon** — 常驻进程，管理 WebSocket 桥接和 HTTP API
- **Chrome Extension** — Manifest V3，offscreen 页维持长连接

## 进阶用法

### 页面性能分析

```bash
# 1. 获取核心 Web Vitals
browser_evaluate({ expression: "..." })  # Navigation Timing + FCP

# 2. CDP 深度指标
browser_cdp({ method: "Performance.getMetrics" })

# 3. 网络请求抓包
browser_cdp_session({ enable: ["Network"], durationMs: 3000 })

# 4. CPU Profiling
browser_cdp_session({ enable: ["Profiler"], durationMs: 5000 })
```

### 自动化测试

```bash
browser_run_steps({
  screenshotOnError: true,
  steps: [
    { action: "open", url: "https://app.example.com/login" },
    { action: "fillForm", fields: [
      { placeholder: "Email", value: "test@example.com" },
      { placeholder: "Password", value: "test123" }
    ]},
    { action: "click", text: "Sign In" },
    { action: "assertText", contains: "Dashboard" },
    { action: "screenshot" }
  ]
})
```

## 开发

```bash
pnpm install          # 安装依赖
pnpm build            # 构建所有包
pnpm typecheck        # 类型检查
pnpm smoke            # MCP 冒烟测试
pnpm dev:server       # 启动开发 MCP 服务
```

## 兼容

| 客户端 | 状态 |
|---|---|
| Claude Code | ✅ 已验证 |
| Cursor | ✅ 支持 |
| Codex | ✅ 支持 |
| Gemini CLI | ✅ 支持 |
| 任何 MCP 客户端 | ✅ 标准协议 |

## License

MIT
