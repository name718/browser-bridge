# 更新日志 (Changelog)

所有对本项目的重大变更都将记录在此文件中。

## [0.3.1] - 2026-06-15

### 新增
- **AI QA 流程闭环增强**:
    - `browser_qa_run` 增加执行前预检，支持 Bridge 连接、活动标签页、baseUrl 可达性和既有 Console 错误检查。
    - 失败诊断包增强，记录失败步骤、当前页面、Locator 策略、证据可用性、Console/Network/PageModel/Screenshot 产物。
    - 语义用例与可执行用例资产分离，运行目录新增 `run-config.json`、`semantic-cases.json`、`executable-cases.json` 和 `workflow-state.json`。
    - 报告产品化，HTML/Markdown/CI Summary 新增发布建议、失败聚合、证据缺口和决策分类。
    - `browser_qa_from_recording` 增强录制转用例能力，新增 `recording-analysis.json`，标记敏感输入、Locator 风险和建议补充断言。
    - `browser_qa_replay` smart 模式增强，交互步骤会生成可审计 Locator fallback 和自愈元数据。
- **插件蒙层交互增强**:
    - Agent 激活蒙层新增主动关闭按钮。
    - 蒙层支持拖拽移动。
    - 蒙层支持缩小/展开，缩小时隐藏操作日志。
- **工作流治理**:
    - 新增 Browser Bridge QA 流程优化计划文档。
    - Skill 工作流新增 `workflow-state.json` 阶段门禁格式，便于恢复和防止跳阶段。

### 优化
- 修复 Website 在 Tailwind CSS 4 下的 PostCSS 插件配置，`pnpm build` 可完整通过。
- 更新 Chrome 插件下载链接至 `release/browser-bridge-extension-0.3.1.zip`。

## [0.3.0] - 2026-05-29

### 新增
- **交互视觉革命**:
    - **究极赛博朋克蒙层**: 引入全新的 Sci-Fi 视觉系统，包含六边形蜂巢矩阵背景、动态二进制数据流、色散扫描线以及故障风格（Glitch）动画。
    - **实时操作详情**: 蒙层现在会实时显示 Agent 正在执行的具体指令及其参数（如点击的选择器、输入的文本），并支持中文显示。
- **持久化会话控制**:
    - **`browser_use` 升级**: 支持 `use: true/false` 参数。Agent 可通过此工具宣告“开始/结束会话”，实现蒙层的长效驻留，而非仅在操作时闪烁。
    - **不活跃自动关闭**: 引入 5 分钟安全超时机制，若 Agent 忘记关闭协议且无操作，蒙层将自动退出。
- **全局同步机制**:
    - **跨标签页状态同步**: 蒙层状态现在由 Background 全局管理。Agent 激活协议后，所有现有标签页及随后新打开的标签页均会自动开启蒙层。
- **界面精简**:
    - **Popup 优化**: 隐藏了插件弹出框中的“操作录制”和“最近操作”区块，提供更清爽的配置体验。

## [0.2.1] - 2026-05-27

### 新增
- **开发者工具**:
    - 新增 `browser_console_monitor` 工具：通过 CDP 实时捕获页面的控制台日志（log, warn, error）及未捕获的运行时异常。

## [0.2.0] - 2026-05-27

### 新增
- **性能与 Token 效率优化**:
    - 升级 `browser_get_page_text`：支持返回结构化 Markdown（包含标题、列表和表格），增强 AI 对页面层级的理解。
    - `browser_get_page_snapshot` 引入“结构折叠（Structure Folding）”机制：自动剪枝重复的兄弟元素（如长列表、商品网格），显著降低 Token 消耗。
- **稳定性增强**:
    - 引入“智能自动等待（Auto-Waiting）”逻辑：在交互前自动检查元素的可见性、启用状态及位移稳定性。
    - 操作视觉反馈：在浏览器内增加视觉波纹动画（点击为红色，输入为蓝色），便于肉眼追踪 AI 操作。
    - 拟人化输入改进：`typeIntoElement` 升级为逐字发送键盘事件，并加入随机延迟。
- **进阶特性**:
    - 新增 `browser_get_ax_tree`：通过 CDP 获取完整的无障碍树（Accessibility Tree），提供更纯净的语义化页面结构。
    - 新增 `browser_wait_for_request`：支持监听并等待特定的网络请求（URL Pattern）完成。
- **文档**:
    - 初始化 `CHANGELOG.md`（本文件）。

### 修复
- 修复了冒烟测试（Smoke Test）中的激活流程问题。
- 合并并清理了冗余的 `typeIntoElement` 和 `fillForm` 实现，统一了交互逻辑。
