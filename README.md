# Browser Bridge

<p align="center">
<b>让 AI 代理操控你的真实浏览器</b><br/>
通过 MCP 协议，连接 Claude Code / Cursor / Codex / Gemini CLI 到你的 Chrome 浏览器
</p>

<p align="center">
  <a href="#特性">特性</a> ·
  <a href="#使用场景">使用场景</a> ·
  <a href="#ai-自动化测试">AI 自动化测试</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#工具一览">工具一览</a> ·
  <a href="#文档入口">文档入口</a> ·
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

### AI 自动化测试 — 计划、执行、报告、回放

```json
// 根据 PRD/focus/git diff 生成测试计划
browser_qa_plan({
  "baseUrl": "https://staging.example.com",
  "prdText": "用户可以搜索订单，并校验退款金额",
  "focus": ["订单搜索", "退款金额校验"]
})

// 执行测试用例并生成报告与 replay
browser_qa_run({
  "taskId": "refund-flow",
  "title": "退款流程测试",
  "cases": [{
    "id": "refund-main-flow",
    "title": "退款主流程可完成",
    "priority": "P0",
    "steps": [
      { "action": "open", "url": "https://staging.example.com/orders/123" },
      { "action": "click", "text": "申请退款" },
      { "action": "type", "placeholder": "退款金额", "value": "10" },
      { "action": "click", "text": "提交" },
      { "action": "assertText", "contains": "退款中" }
    ]
  }]
})

// 回放已生成的 replay.json
browser_qa_replay({
  "replayPath": ".browser-bridge/runs/refund-flow/replay.json",
  "mode": "smart"
})
```

测试运行会在 `.browser-bridge/runs/{taskId}` 下生成：

- `report.html` / `report.md`：测试报告
- `replay-viewer.html`：可视化回放时间线
- `replay.json`：机器可执行回放文件
- `ci-summary.json`：CI/PR 汇总
- `cases/`、`screenshots/`、`logs/`：用例、截图和日志证据

### 与 Computer Use 配合

Browser Bridge 面向普通网页：优先用 DOM、文本、交互元素和 CDP 做低 token 的结构化操作。遇到 Chrome 外壳、`chrome://` 页面、扩展管理页、系统弹窗、文件选择器，或网页控件只能靠屏幕识别时，Agent 应切换到 Computer Use 兜底。

推荐调度规则：

- 普通网页读取、点击、输入、断言、性能分析：用 `browser_*` 工具。
- 可视区域截图和给 Agent 看图：用 `browser_screenshot`。
- 需要落盘保存图片/PDF：用 `browser_save_screenshot` / `browser_save_pdf`。
- 扩展 reload、浏览器权限弹窗、系统 UI、非网页 App：用 Computer Use。
- `browser_find` 找不到但屏幕可见的目标：改用 Computer Use 点 UI。

## 工具一览

共 **56 个 MCP 工具**，分为 12 大类：

| 类别 | 工具 | 说明 |
|---|---|---|
| **连接** | `browser_use` `browser_status` | 激活和状态检查 |
| **标签页** | `browser_list_tabs` `browser_open_url` `browser_activate_tab` `browser_get_active_tab` | 标签页管理 |
| **页面读取** | `browser_get_page_text` `browser_get_page_snapshot` `browser_get_interactives` `browser_get_links` `browser_get_selected_text` `browser_capture_page` `browser_get_ax_tree` | 增加无障碍树读取 |
| **截图/导出** | `browser_screenshot` `browser_save_screenshot` `browser_pdf` `browser_save_pdf` | 视觉捕获 |
| **元素查找** | `browser_find` `browser_find_and_click` `browser_find_and_type` | 智能元素定位 |
| **元素操作** | `browser_click` `browser_type` `browser_clear` `browser_hover` `browser_press_key` `browser_fill_form` `browser_scroll` `browser_wait_for` `browser_assert_text` | 交互操作 |
| **脚本执行** | `browser_evaluate` | 自定义 JS 执行 |
| **CDP** | `browser_cdp` `browser_cdp_session` | Chrome DevTools Protocol |
| **性能分析** | `browser_responsive` `browser_network_analysis` | 响应式测试 + 网络分析 |
| **网络与监控** | `browser_wait_for_request` `browser_console_monitor` `browser_get_audit_log` | 请求监听 + 控制台监控 + 审计 |
| **自动化** | `browser_run_steps` | 多步骤流程 |
| **AI QA** | `browser_qa_plan` `browser_qa_run` `browser_qa_from_recording` `browser_qa_replay` `browser_qa_report` | 计划、执行、报告、录制转用例、回放 |

## 使用场景

你只需要用自然语言告诉 Agent 做什么，Agent 会自动选择合适的工具完成任务。

### 页面分析

> **你**：帮我分析一下这个页面是干什么的
>
> **Agent**：打开页面 → `browser_capture_page` 获取 PDF 内容 → 分析页面结构和功能，输出总结

### 页面性能分析

> **你**：帮我分析这个页面的加载性能
>
> **Agent**：`browser_network_analysis` 抓取网络请求 → `browser_cdp({ method: "Performance.getMetrics" })` 获取性能指标 → 分析慢请求、传输大小、关键指标，输出报告

### 响应式布局测试

> **你**：帮我看看这个页面在手机上显示正常吗
>
> **Agent**：`browser_responsive` 自动在 Desktop / Tablet / Mobile 三种视口下截图 → 对比截图，指出布局问题

### 自动化回归测试

> **你**：帮我测一下登录流程有没有问题
>
> **Agent**：`browser_run_steps` 按步骤操作：打开登录页 → 填写表单 → 点击登录 → 断言页面出现 "Dashboard" → 截图留档

### AI QA 测试报告

> **你**：基于当前分支和 PRD，去测试环境跑一轮 AI QA，输出报告和回放
>
> **Agent**：`browser_qa_plan` 生成测试范围和回归影响点 → `browser_qa_run` 执行用例 → 保存 `report.html`、`replay-viewer.html`、`replay.json` 和 `ci-summary.json`

### 录制转测试用例

> **你**：我手动走一遍流程，你把它变成可回放测试
>
> **Agent**：`browser_toggle_recording` 开启录制 → 用户操作页面 → `browser_get_recorded_steps` 获取步骤 → `browser_qa_from_recording` 清洗为 QA case 和 replay

### 批量填表单

> **你**：帮我把这个注册表单填了
>
> **Agent**：`browser_fill_form` 一次性填写邮箱、密码、昵称等所有字段，不需要逐个查找

### JS 调试

> **你**：帮我看看 `window.__vm__` 上的用户数据对不对
>
> **Agent**：`browser_evaluate({ expression: "window.__vm__" })` 直接在页面 MAIN world 执行，返回结果

### Console 错误排查

> **你**：帮我看看这个页面有没有报错
>
> **Agent**：`browser_cdp_session({ enable: ["Runtime"], durationMs: 5000 })` 收集 console.error 和未捕获异常，列出所有错误及调用栈

### 网络请求分析

> **你**：帮我看看有哪些接口请求慢了
>
> **Agent**：`browser_network_analysis` 监听 3 秒网络请求 → 按耗时排序 → 输出慢请求列表（>1s）及传输大小

### CPU 性能分析

> **你**：帮我 profile 一下点击按钮后的 CPU 占用
>
> **Agent**：`browser_cdp({ method: "Profiler.start" })` → 点击按钮 → `browser_cdp({ method: "Profiler.stop" })` → 返回火焰图数据，定位热点函数

### 数据抓取

> **你**：帮我把这个列表页的商品名称和价格抓下来
>
> **Agent**：`browser_evaluate` 注入自定义 JS 遍历 DOM → 返回结构化 JSON 数据

### UI 走查

> **你**：帮我截个图看看现在页面长什么样
>
> **Agent**：`browser_screenshot` 截取当前可视区域 → 直接返回截图；需要更清晰时传 `mode: "cdp", scale: 2`

### Bug 复现

> **你**：按照步骤操作一下看看能不能复现这个 bug
>
> **Agent**：`browser_run_steps` 按你描述的步骤依次操作，每步 assert 校验，失败时自动截图

### 内存泄漏排查

> **你**：帮我看看这个页面有没有内存泄漏
>
> **Agent**：`browser_cdp_session({ enable: ["HeapProfiler"], durationMs: 3000 })` → 分析堆快照数据

### DOM 结构查看

> **你**：帮我看看这个页面的 DOM 树结构
>
> **Agent**：`browser_cdp({ method: "DOM.getDocument", params: { depth: 2 } })` → 返回完整 DOM 树

### CSS 覆盖率

> **你**：帮我看看这个页面有多少 CSS 是没用到的
>
> **Agent**：`browser_cdp({ method: "CSS.startCoverage" })` → 操作页面 → 获取覆盖率报告

### 登录态验证

> **你**：帮我看看现在是不是登录状态
>
> **Agent**：`browser_evaluate` 读取 cookie 或 token → 判断登录状态并返回

### 截图保存

> **你**：帮我把这个页面截图保存成文件
>
> **Agent**：`browser_save_screenshot` 截图并保存为 PNG/JPG 文件，返回文件路径。直接看图时使用 `browser_screenshot`

### 导出 PDF

> **你**：帮我把这个文档页导出成 PDF
>
> **Agent**：`browser_pdf` 用 CDP `Page.printToPDF` 导出，返回 base64 PDF 数据

### 可访问性检查

> **你**：帮我看看这个页面的按钮有没有 aria-label
>
> **Agent**：`browser_get_interactives` 获取所有可交互元素 → 检查 aria 属性完整度

## 快速开始

### 1. 安装 Chrome 插件

当前版本暂未上架 Chrome Web Store。请从仓库的 `release/browser-bridge-extension-0.3.0.zip` 解压后手动加载：

1. 解压 `release/browser-bridge-extension-0.3.0.zip`
2. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择解压后的插件目录

### 2. 配置 MCP 客户端

在你的 MCP 客户端（Claude Code、Cursor 等）中添加：

```json
{
  "mcpServers": {
    "browser-bridge": {
      "command": "npx",
      "args": [
        "-y",
        "-p",
        "@majuntao-1/browser-bridge-mcp-server",
        "browser-bridge-mcp"
      ],
      "env": {
        "BROWSER_BRIDGE_PORT": "17321"
      }
    }
  }
}
```

如果你的环境禁止 `npx` 联网，也可以先全局安装：

```bash
npm install -g @majuntao-1/browser-bridge-mcp-server --registry=https://registry.npmjs.org/
```

然后把 MCP 命令改为：

```json
{
  "mcpServers": {
    "browser-bridge": {
      "command": "browser-bridge-mcp",
      "args": [],
      "env": {
        "BROWSER_BRIDGE_PORT": "17321"
      }
    }
  }
}
```

### 3. 连接插件

MCP 代理首次调用时会自动启动本地 daemon。打开 Chrome 工具栏里的“浏览器桥接”插件，确认桥接地址为：

```text
ws://127.0.0.1:17321
```

点击“保存并重连”，状态显示「已连接」后即可使用。

### 4. 开始使用

在支持 MCP 的 AI 客户端中调用：

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

### AI QA：计划、执行、回放

生成测试计划：

```bash
browser_qa_plan({
  "baseUrl": "https://staging.example.com",
  "prdText": "用户可以搜索订单、查看订单详情，并对退款金额做校验。",
  "focus": ["订单搜索", "退款金额校验"]
})
```

执行测试并生成报告：

```bash
browser_qa_run({
  "taskId": "order-refund",
  "title": "订单退款 AI QA",
  "outputDir": ".browser-bridge/runs/order-refund",
  "cases": [{
    "id": "open-page",
    "title": "测试环境页面可打开",
    "priority": "P0",
    "expected": ["页面可打开并截图"],
    "steps": [
      { "action": "open", "url": "https://staging.example.com" },
      { "action": "pageModel", "visibleOnly": true, "maxElements": 80 },
      { "action": "screenshot" }
    ]
  }],
  "captureConsole": true,
  "captureNetwork": true,
  "screenshotOnError": true
})
```

回放：

```bash
browser_qa_replay({
  "replayPath": ".browser-bridge/runs/order-refund/replay.json",
  "mode": "smart"
})
```

重新生成报告或 CI 汇总：

```bash
browser_qa_report({
  "runDir": ".browser-bridge/runs/order-refund",
  "format": "viewer"
})
```

当前 AI QA 规划是本地启发式实现：会读取 PRD 文本、focus 和 git diff 推断测试范围，但不调用外部大模型。更复杂的自然语言推理可由上层 AI Agent 基于 `browser_qa_plan` 输出继续补全用例。

## 文档入口

文档已收敛为三个入口：

- `README.md`：项目介绍、快速开始、工具说明和常用示例。
- `docs/ai-qa-automation-plan.md`：AI QA 自动化测试方案、当前实现状态、边界和后续计划。
- `docs/security.md`：安全机制、配置项和审计说明。

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
