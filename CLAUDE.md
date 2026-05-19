# CLAUDE.md

Browser Bridge — MCP 工具让 AI 代理操控真实 Chrome 浏览器。

## 构建

```bash
source ~/.nvm/nvm.sh && nvm use 22
pnpm install
pnpm build
pnpm typecheck
pnpm smoke
```

## 包结构

- `packages/shared` — 共享协议和类型（BridgeTool、类型定义）
- `packages/mcp-server` — MCP stdio 服务 + WebSocket daemon
- `packages/extension` — Chrome Manifest V3 插件

## 性能分析标准流程

**核心原则：先用 CDP，不用注入 observer。CDP 从开启时刻就开始收集，不存在"来晚了"的问题。**

### CPU Profiling（火焰图）

```
1. browser_cdp({ method: "Profiler.enable" })
2. browser_cdp({ method: "Profiler.start" })
3. [执行目标操作，如 browser_click / browser_run_steps]
4. browser_cdp({ method: "Profiler.stop" })
```

Profiler.stop 返回的 profile 数据包含 nodes、samples、timeDeltas，可定位到具体函数的 CPU 占用。

### 长任务 / 性能事件采集

```
browser_cdp_session({ enable: ["Performance"], durationMs: 5000 })
```

返回 5 秒内所有 Performance 域事件（metrics、长任务等）。

### Console 日志捕获

```
browser_cdp_session({ enable: ["Runtime"], durationMs: 5000 })
```

返回 Runtime.consoleAPICalled 事件，包含所有 console.log/warn/error 输出。

### Console 错误收集（专项）

收集页面错误分三层：

```
// 1. console.error() 输出 — 业务层错误
browser_cdp_session({ enable: ["Runtime"], durationMs: 5000 })
// 过滤 event.method === "Runtime.consoleAPICalled" 且 params.type === "error"

// 2. 未捕获异常 — JS 运行时错误
browser_cdp({ method: "Runtime.enable" })
browser_cdp({ method: "Runtime.evaluate", params: {
  expression: `
    window.__errors__ = [];
    window.addEventListener('error', e => window.__errors__.push({
      message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno
    }));
    window.addEventListener('unhandledrejection', e => window.__errors__.push({
      message: e.reason?.message || String(e.reason), type: 'unhandledrejection'
    }));
  `
}})
// 操作页面后读取：
browser_evaluate({ expression: "JSON.stringify(window.__errors__)" })

// 3. 组合采集（推荐 — 一次拿到所有错误相关事件）
browser_cdp_session({
  enable: ["Runtime", "Console"],
  durationMs: 5000
})
```

**快速方案**：如果只需要收集错误，用 `browser_evaluate` 注入全局 error listener 最简单。如果需要完整调用栈，用 `browser_cdp_session` 监听 Runtime 域。

### 内存堆快照

```
browser_cdp_session({ enable: ["HeapProfiler"], durationMs: 3000 })
```

### 组合采集（推荐）

```
browser_cdp_session({
  enable: ["Performance", "Runtime", "Network"],
  durationMs: 5000
})
```

一次拿到性能指标 + console 日志 + 网络请求。

### 一次性 CDP 命令

```
browser_cdp({ method: "Performance.getMetrics" })
browser_cdp({ method: "DOM.getDocument", params: { depth: 2 } })
browser_cdp({ method: "CSS.startCoverage" })
```

## 通用工具速查

### 页面内容获取（按 token 成本排序）

1. `browser_get_interactives` — 仅交互元素，最省 token
2. `browser_get_page_text` — 仅文本
3. `browser_capture_page` — 智能降级：PDF → 截图 → DOM
4. `browser_screenshot` / `browser_pdf` — 视觉捕获

### 自定义 JS 执行

```
browser_evaluate({ expression: "window.__vm__.$data" })
browser_evaluate({ expression: "JSON.stringify(performance.getEntriesByType('navigation')[0])" })
```

在页面 MAIN world 执行，可访问 window 上所有全局变量。

### 多步骤自动化

```
browser_run_steps({
  screenshotOnError: true,
  steps: [
    { action: "open", url: "..." },
    { action: "click", text: "..." },
    { action: "assertText", contains: "..." }
  ]
})
```

## 常见坑

- **不要在页面加载后才注入 PerformanceObserver 做性能分析** — 长任务、paint 等事件不会回溯。用 CDP 代替。
- **browser_evaluate 返回值必须 JSON 可序列化** — function、DOM 节点等不可序列化的会被转为字符串。
- **browser_cdp_session 的 durationMs 最低 100ms** — 太短会收不到事件。
- **DevTools 打开时 CDP 会冲突** — 返回 DEBUGGER_BUSY 错误，需关闭 DevTools。
