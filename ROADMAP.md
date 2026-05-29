# Browser Bridge 竞争力分析与特性演进路线图 (Roadmap)

本中心文档基于对当前 `browser-bridge` 项目与 **Playwright MCP** 以及官方 **chrome-devtools-mcp** 的深度对比，提炼出一份旨在打造“最强浏览器操作桥梁”的特性增强列表及实施计划。

## 1. 竞品深度对比分析

| 维度 | 当前 Browser Bridge | Playwright MCP | Chrome DevTools MCP |
| :--- | :--- | :--- | :--- |
| **核心定位** | **真实环境接管**：操控用户已登录的、真实的浏览器。 | **无头/自动化测试**：侧重从干净环境开始的自动化流程。 | **底层调试**：直接暴露 CDP 接口，侧重底层指标。 |
| **选择器引擎** | 启发式评分 (Text, ARIA, Placeholder)，灵活但非标准。 | **标准且强大**：支持 CSS, XPath, Text, ARIA, React, Pick。 | 仅限原生 `querySelector`。 |
| **交互可靠性** | 手动事件分发，存在某些复杂 SPA 无法触发点击的情况。 | **极高**：内置 Auto-waiting (等待稳定、可见、可交互)。 | 无。 |
| **反馈机制** | 内置 Agent Overlay，直接在页面显示操作状态。 | Trace Viewer 离线调试。 | 原生 DevTools 面板。 |
| **主要优势** | **零配置登录态**、意图式操作 (`browser_act`)。 | **工业级稳定性**、丰富的选择器组合。 | **全量 CDP 能力**、极致的性能分析。 |

---

## 2. 特性演进列表 (Feature List)

### A. 核心交互层 (稳定性增强)
1. **Playwright 选择器引擎支持**: 引入对 `internal:role`, `text=`, `css:light=`, `xpath=` 等标准选择器的支持。
2. **智能操作检查 (Actionability Checks)**: 在点击/输入前自动检查：可见性、稳定性（是否在移动）、是否被遮挡、是否已启用。
3. **CDP 底层交互驱动**: 在 Content Script 事件分发失效时，自动降级为使用 CDP `Input` 域进行模拟点击和输入。

### B. 视觉感知层 (AI 视觉增强)
4. **交互式截图标注 (Visual Mapping)**: 提供 `browser_screenshot` 的标注模式，在图片上自动绘制可交互元素的边界框和 ID。
5. **多维失败诊断包**: 操作失败时自动返回：目标区域微截图、相关 HTML 片段、最后 5 条 Console 日志。
6. **简化 AOM 树 (Accessibility Object Model)**: 优化 `browser_get_ax_tree`，生成更紧凑、更符合 LLM 阅读习惯的文本缩进树。

### C. 网络与环境层 (深度控制)
7. **声明式网络路由**: 实现 `browser_route` 工具，允许 AI 拦截请求、修改 Header 或 Mock 响应。
8. **会话快照管理**: 提供导出/导入 Cookie 和 LocalStorage 的工具，方便在不同环境间同步已登录状态。

---

## 3. 分阶段实施计划 (Implementation Plan)

### 第一阶段：交互稳定性与定位增强 (稳定性打底)
- **目标**: 解决“点不准、点不到、找不到”的问题。
- **任务**:
    - [ ] 集成 Playwright 风格的选择器解析逻辑。
    - [ ] 实现 `ensureElementActionable` 检查机制。
    - [ ] 优化 `browser_click` 和 `browser_type` 的底层执行逻辑。

### 第二阶段：AI 感知力与诊断提升 (体验升级)
- **目标**: 让 AI “看”得更清，失败时能自己诊断。
- **任务**:
    - [ ] 实现带标注的截图功能 (`overlay: true`)。
    - [ ] 升级错误处理机制，返回包含上下文信息的“诊断包”。
    - [ ] 进一步精简 AOM 树的 Token 占用。

### 第三阶段：深度控制与高级自动化 (功能扩展)
- **目标**: 提供类似原生 DevTools 的深度控制能力。
- **任务**:
    - [ ] 封装基于 CDP `Fetch` 域的 `browser_route` 工具。
    - [ ] 实现会话 (Storage/Cookies) 的导入导出工具。
    - [ ] 完善多标签页 (Multi-tab) 的协同调度逻辑。

---

## 4. 结论

通过本路线图的实施，`browser-bridge` 将进化为一个 **“拥有 Playwright 稳定性、DevTools 深度、且能直接操作用户真实会话”** 的终极 AI 浏览器代理框架。
