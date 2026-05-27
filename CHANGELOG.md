# 更新日志 (Changelog)

所有对本项目的重大变更都将记录在此文件中。

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
