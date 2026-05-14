# Browser Bridge 开发 Plan

## 阶段 0：设计落地

目标：明确系统边界、协议、权限和 MVP 范围。

任务：

- 确定整体架构。
- 确定 MCP tools 列表。
- 确定 Chrome Extension 权限策略。
- 定义 MCP Server 和 Chrome Extension 的通信协议。
- 定义页面快照数据结构。
- 定义错误码。
- 定义安全策略。

产出：

- `技术方案.md`
- MCP tools 设计文档
- 通信协议定义
- 安全策略说明

验收标准：

- 明确 MVP 做什么。
- 明确哪些能力暂不开放。
- 明确默认不支持任意 JS、Cookie 读取、网络拦截。

## 阶段 1：只读 MVP

目标：打通 AI Agent 到 Chrome 页面读取的完整链路。

任务：

- 初始化 monorepo 项目结构。
- 创建 `packages/shared`，定义协议和类型。
- 创建 `packages/mcp-server`。
- 创建 `packages/extension`。
- MCP Server 启动并注册基础 tools。
- Chrome Extension background 连接 MCP Server。
- 实现连接状态管理。
- 实现获取当前活动 tab。
- 实现读取当前页面标题、URL、可见文本。
- 实现页面基础元素提取。

MCP tools：

```text
browser_status
browser_get_active_tab
browser_get_page_text
browser_get_page_snapshot
```

验收标准：

- 插件能够成功连接 MCP Server。
- Agent 能获取浏览器连接状态。
- Agent 能读取当前活动 tab。
- Agent 能读取当前页面标题、URL、文本。
- Agent 能读取已登录网站页面内容。
- password input 的真实值不会被返回。

## 阶段 2：基础页面操作

目标：支持低风险浏览器操作。

任务：

- 实现 tab 列表读取。
- 实现打开 URL。
- 实现切换 tab。
- 实现元素点击。
- 实现文本输入。
- 实现清空输入框。
- 实现滚动。
- 实现等待元素出现。
- 为页面元素生成稳定 `elementId`。
- 操作失败时返回结构化错误。

MCP tools：

```text
browser_list_tabs
browser_open_url
browser_activate_tab
browser_click
browser_type
browser_clear
browser_scroll
browser_wait_for
```

验收标准：

- 能打开指定 URL。
- 能在普通表单中填写文本。
- 能点击按钮和链接。
- 能滚动页面。
- 能等待异步加载后的元素。
- 元素不存在、不可见、disabled、超时时返回明确错误。

## 阶段 3：安全机制

目标：让工具具备长期可用的安全边界。

任务：

- 实现 pairing token。
- 实现 allowlist。
- 实现 denylist。
- 实现敏感字段脱敏。
- 实现高风险操作识别。
- 实现用户确认机制。
- 实现本地审计日志。
- 实现 extension popup 状态页。

高风险操作：

- 删除
- 支付
- 发布
- 发送消息
- 提交表单
- 修改权限

验收标准：

- 未配对 MCP Server 无法连接插件。
- 非 allowlist 域名默认拒绝或只读。
- 高风险操作执行前需要用户确认。
- 用户拒绝后操作不会继续。
- 审计日志能记录操作时间、页面、tool、结果。
- 日志不记录敏感字段原文。

## 阶段 4：截图和视觉能力

目标：让 Agent 可以理解页面视觉状态。

任务：

- 实现 viewport 截图。
- 实现元素截图。
- 页面快照中加入元素坐标。
- 支持截图返回 base64 或本地临时文件路径。
- 为隐私域名增加禁用截图配置。

MCP tools：

```text
browser_screenshot
browser_element_screenshot
```

验收标准：

- Agent 可以获取当前页面截图。
- 元素坐标和截图位置基本一致。
- 被禁用截图的域名不会返回截图。
- 截图失败时返回明确错误。

## 阶段 5：复杂页面增强

目标：提升对真实业务后台和复杂前端页面的适配能力。

任务：

- 支持 iframe 页面读取。
- 支持 iframe 内元素操作。
- 支持开放 Shadow DOM。
- 支持表格结构化抽取。
- 支持表单结构化抽取。
- 支持虚拟列表的基础读取策略。
- 支持 Canvas 截图。
- 支持下载状态检测。

MCP tools：

```text
browser_get_table
browser_get_forms
browser_get_frames
browser_get_downloads
browser_get_canvas_screenshot
```

验收标准：

- 能读取常见后台系统表格。
- 能识别并填写常见表单。
- 能处理 iframe 中的按钮和输入框。
- 能对 Canvas 区域截图。
- 能检测浏览器下载任务状态。

## 阶段 6：高级自动化，可选

目标：提供更强的浏览器控制能力，但默认关闭。

可选能力：

- Chrome Debugger Protocol。
- 坐标点击。
- console log 读取。
- 网络请求观察。
- 文件上传。
- 页面性能信息。

要求：

- 该阶段必须作为 Advanced Mode。
- 用户需要显式开启。
- 插件需要清楚展示新增权限。
- 高风险能力需要单独审计。

验收标准：

- Advanced Mode 默认关闭。
- 开启前有明确权限说明。
- 高风险 tool 有独立开关。
- 所有高级操作可审计。

## MVP 最小闭环

最小可交付版本只需要完成：

```text
browser_status
browser_get_active_tab
browser_get_page_text
browser_get_page_snapshot
browser_click
```

MVP 验证目标：

- MCP Server 能运行。
- Chrome Extension 能连接。
- Agent 能读取当前浏览器页面。
- Agent 能读取已登录页面内容。
- Agent 能点击一个页面元素。
- 操作失败时有明确错误。

## 推荐执行顺序

1. 初始化 monorepo。
2. 定义 shared protocol。
3. 实现 MCP Server 基础框架。
4. 实现 WebSocket bridge。
5. 实现 Chrome Extension background 连接。
6. 实现 content script 页面读取。
7. 暴露 `browser_get_page_snapshot`。
8. 实现 `browser_click`。
9. 增加错误码和超时。
10. 增加安全控制和日志。

## 测试策略

### 单元测试

- 协议类型校验。
- 错误码映射。
- MCP tool 参数校验。
- 安全策略判断。
- 元素快照生成逻辑。

### 集成测试

- MCP Server 和插件连接。
- 页面读取。
- tab 操作。
- click/type/scroll。
- 超时和断线重连。

### 手工验收

- 普通公开网页。
- 已登录网站。
- 企业内网页面。
- 表单页面。
- 表格页面。
- 动态加载页面。

## 风险控制清单

- 默认不开放任意 JS 执行。
- 默认不读取 Cookie。
- 默认不返回 password input value。
- 默认只监听 `127.0.0.1`。
- 高风险操作需要确认。
- 操作日志脱敏。
- 插件断线后 MCP tool 返回明确错误。
- 非 allowlist 域名受限。

## 第一版完成标准

第一版完成后应满足：

- 本地 AI Agent 能通过 MCP 发现 browser tools。
- Chrome Extension 能稳定连接 MCP Server。
- 能读取当前 tab 页面文本和元素。
- 能对普通页面执行点击。
- 能处理连接失败、元素不存在、权限不足等错误。
- 有基础安全限制，避免明显误操作。
