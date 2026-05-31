# AI 自动化测试方案、实现状态与开发计划

## 背景

Browser Bridge 当前已经具备真实 Chrome 浏览器操控能力，包括页面观察、元素查找、点击输入、步骤执行、截图/PDF、Console 监听、Network 分析、CDP 调试、会话导入导出和用户操作录制。

下一阶段目标不是把项目做成另一个传统 E2E 框架，而是升级为面向 AI Agent 的自动化测试执行引擎：

- AI 开发功能后，可以自己打开浏览器验证功能是否成功。
- 用户可以提供测试环境 URL、PRD、代码分支、测试重点，AI 自动生成测试计划并执行。
- AI 可以覆盖主流程、异常流程和回归影响点。
- 执行过程中自动采集截图、Console、Network、页面模型和失败上下文。
- 最后输出测试报告，并生成可回放脚本。

## 当前实现状态

当前已经完成一个可运行的工程闭环：

- `browser_qa_plan`：根据 `baseUrl`、`prdPath` / `prdText`、`focus`、`branch` / `compareBranch` 和 git diff 生成本地启发式测试计划。
- `browser_qa_run`：执行结构化 QA cases，生成 `summary.json`、`report.md`、`report.html`、`replay.json`、`replay-viewer.html`、`ci-summary.json`。
- `browser_qa_from_recording`：读取浏览器录制步骤，清洗并转成 QA case / replay；可选 `run=true` 立即执行。
- `browser_qa_replay`：读取 `replay.json` 回放，支持 `strict` 和 `smart` 两种模式。
- `browser_qa_report`：按 run 目录重建 Markdown、HTML、Replay Viewer 或 CI Summary。
- 扩展录制已增强：支持 click、input、change、keydown、submit、scroll、URL change，并记录 `data-testid`、role、ariaLabel、placeholder、selectorHint、nearText、rect 等定位线索。
- 录制默认对 password、token、验证码等敏感输入脱敏。

当前边界：

- `browser_qa_plan` 是本地启发式规划，不直接调用外部 LLM。复杂 PRD 语义理解应由上层 AI Agent 继续补全 cases。
- `smart` replay 当前是语义定位参数增强，会补充 `query`、`visibleOnly` 和默认 timeout；不是完整的模型级自愈。
- `browser_qa_from_recording` 可以清洗录制步骤并生成 case，但“自动补充业务断言”仍需要上层 AI Agent 根据页面结果继续增强。
- 报告已包含结构化结果、产物路径和步骤时间线；更深入的失败根因分析仍依赖 Console/Network/PageModel 证据和上层 AI 总结。

## 目标效果

用户可以直接描述测试任务：

```text
基于当前分支和 docs/refund-prd.md，
去 https://staging.example.com 跑一轮 AI QA，
重点测试退款申请、金额校验、订单列表回归，
最后输出测试报告和回放脚本。
```

最终产物：

```text
.browser-bridge/runs/refund-flow/
  report.md
  report.html
  summary.json
  replay.json
  replay-viewer.html
  ci-summary.json
  cases/
    refund-main-flow.json
    refund-invalid-amount.json
  screenshots/
    refund-main-flow-step-1.png
    refund-main-flow-pass.png
    refund-invalid-amount-fail.png
  logs/
    console.json
    network.json
  page-models/
    refund-main-flow-before.json
    refund-invalid-amount-failure.json
```

报告需要给出明确结论：

- 本次测试范围
- 通过/失败/阻塞用例数
- P0/P1/P2 风险
- 失败问题和复现步骤
- 截图、Console、Network 证据
- 回归影响点验证结果
- 可回放文件路径

## 当前能力基础

当前项目已有能力可以直接复用：

- 浏览器真实环境操作：`browser_open_url`、`browser_act`、`browser_find_and_click`、`browser_fill_form`、`browser_run_steps`
- 页面理解：`browser_observe`、`browser_get_page_model`、`browser_get_page_text`、`browser_get_interactives`
- 断言和等待：`browser_assert_text`、`browser_wait_for`、`browser_wait_for_request`
- 证据采集：`browser_screenshot`、`browser_save_screenshot`、`browser_pdf`、`browser_capture_page`
- 调试数据：`browser_console_monitor`、`browser_network_analysis`、`browser_cdp_session`
- 增强录制：`browser_toggle_recording`、`browser_get_recorded_steps`、`browser_qa_from_recording`
- 会话隔离：`browser_new_context`、`browser_import_session`、`browser_export_session`
- AI QA 编排：`browser_qa_plan`、`browser_qa_run`、`browser_qa_replay`、`browser_qa_report`

仍可继续增强的是：

- 更强的 LLM PRD 理解和自动用例补全。
- 更深入的失败根因分析。
- 更完整的 smart replay 自愈策略。
- 多角色凭据管理和 CI 失败阈值策略。

## 架构原则

Browser Bridge 应保持清晰分层。

```text
AI / MCP Client
  -> MCP Server QA 编排层
  -> 现有 browser_* 工具
  -> WebSocket Bridge
  -> Chrome Extension Background
  -> Content Script / CDP
  -> 真实网页
```

关键原则：

- QA 编排逻辑放在 MCP Server 侧，不放进 Chrome extension。
- Extension 继续负责浏览器能力、权限、安全确认、CDP 和页面脚本转发。
- `browser_run_steps` 继续作为底层结构化执行器。
- 新增 QA 工具只组合现有能力，不破坏现有 browser 工具的通用性。
- 所有测试过程要可审计、可保存、可复现、可回放。

## 新增模块建议

新增目录：

```text
packages/mcp-server/src/qa/
  types.ts
  qa-tools.ts
  planner.ts
  artifacts.ts
  reporter.ts
  recorder.ts
```

职责：

- `types.ts`：定义测试任务、测试计划、测试用例、步骤、结果、报告模型。
- `qa-tools.ts`：注册 MCP 工具。
- `planner.ts`：根据 PRD、focus、git diff、页面模型生成测试计划。
- `artifacts.ts`：保存截图、日志、页面模型、summary。
- `reporter.ts`：生成 Markdown 和 HTML 报告。
- `recorder.ts`：清洗和增强用户录制步骤。

说明：当前 `runner` 和 `replay` 逻辑集中在 `qa-tools.ts` 中，后续如果继续膨胀，可以拆出独立文件。

## 新增 MCP 工具

### `browser_qa_plan`

根据输入生成测试计划，不执行浏览器操作。

当前实现：读取 PRD 文本、focus 和 git diff，使用本地启发式规则生成 scope、risks、regressionAreas 和初始 cases。

输入：

```json
{
  "baseUrl": "https://staging.example.com",
  "prdPath": "docs/refund-prd.md",
  "branch": "feature/refund-flow",
  "focus": ["退款申请", "金额校验", "订单列表回归"]
}
```

输出：

```json
{
  "taskId": "refund-flow",
  "scope": [],
  "cases": [],
  "regressionAreas": [],
  "risks": []
}
```

### `browser_qa_run`

生成计划并执行测试，输出 artifacts 和报告。

当前实现：执行用户传入的 `cases` 或 `steps`。如果需要先自动生成计划，应先调用 `browser_qa_plan`，再由上层 Agent 选择/补全 cases 后调用 `browser_qa_run`。

输入：

```json
{
  "taskId": "refund-flow",
  "baseUrl": "https://staging.example.com",
  "prdPath": "docs/refund-prd.md",
  "branch": "feature/refund-flow",
  "focus": ["退款申请", "金额校验", "订单列表回归"],
  "outputDir": ".browser-bridge/runs/refund-flow",
  "headless": false,
  "recordReplay": true
}
```

输出：

```json
{
  "ok": false,
  "summary": {
    "passed": 10,
    "failed": 2,
    "blocked": 1,
    "risk": "medium"
  },
  "reportMarkdown": ".browser-bridge/runs/refund-flow/report.md",
  "reportHtml": ".browser-bridge/runs/refund-flow/report.html",
  "replay": ".browser-bridge/runs/refund-flow/replay.json"
}
```

实际输出还包含：

```json
{
  "reportHtml": ".browser-bridge/runs/refund-flow/report.html",
  "replayViewer": ".browser-bridge/runs/refund-flow/replay-viewer.html",
  "ciSummary": ".browser-bridge/runs/refund-flow/ci-summary.json"
}
```

### `browser_qa_from_recording`

读取当前扩展录制的用户操作，清洗为 QA case 和 replay。

输入：

```json
{
  "taskId": "refund-recorded-flow",
  "title": "退款录制流程",
  "outputDir": ".browser-bridge/runs/refund-recorded-flow",
  "expected": ["录制流程可以成功回放"],
  "run": false
}
```

输出：

```json
{
  "ok": true,
  "recordedCount": 8,
  "casePath": ".browser-bridge/runs/refund-recorded-flow/recorded-case.json",
  "replayPath": ".browser-bridge/runs/refund-recorded-flow/replay.json"
}
```

### `browser_qa_replay`

读取 `replay.json` 并回放。

输入：

```json
{
  "replayPath": ".browser-bridge/runs/refund-flow/replay.json",
  "mode": "smart",
  "baseUrl": "https://staging.example.com"
}
```

模式：

- `strict`：严格使用录制或生成的 selector/text/placeholder。
- `smart`：为交互步骤补充 `query`、`visibleOnly` 和默认 timeout，让浏览器端语义定位有更多兜底空间。

说明：当前 `smart` 是工程级语义增强，不是完整的模型级自愈。完整自愈应在后续版本中结合页面模型、候选元素和上层 AI 推理。

### `browser_qa_report`

读取某次 run 的结果，重新生成或汇总报告。

输入：

```json
{
  "runDir": ".browser-bridge/runs/refund-flow",
  "format": "html"
}
```

`format` 支持：

- `markdown`：生成 `report.md`
- `html`：生成 `report.html`
- `viewer`：生成 `replay-viewer.html`
- `ci`：生成 `ci-summary.json`

## 测试任务模型

```ts
export type QaTask = {
  taskId: string;
  baseUrl: string;
  prdPath?: string;
  prdText?: string;
  branch?: string;
  compareBranch?: string;
  focus?: string[];
  credentialsRef?: string;
  outputDir?: string;
  recordReplay?: boolean;
};
```

## 测试计划模型

```ts
export type QaPlan = {
  taskId: string;
  title: string;
  scope: string[];
  regressionAreas: string[];
  risks: QaRisk[];
  cases: QaCase[];
};

export type QaCase = {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2";
  type: "main" | "negative" | "edge" | "regression" | "exploratory";
  preconditions?: string[];
  steps: QaStep[];
  expected: string[];
};
```

## 执行策略

每条 case 执行前：

- 打开或激活目标页面。
- 采集页面模型。
- 启动 Console 和 Network 采集。
- 根据 case steps 调用 `browser_run_steps`。

每条 step 执行后：

- 记录耗时。
- 记录当前 URL。
- 必要时截图。
- 必要时断言页面文本。

失败时：

- 截图。
- 保存页面模型。
- 保存当前可交互元素。
- 保存 Console 和 Network。
- 保存失败 step 和错误码。
- 生成复现步骤。

## 报告格式

Markdown 报告用于快速阅读和 PR 评论。

HTML 报告用于完整查看证据，建议包含：

- 顶部总览：通过、失败、阻塞、风险等级。
- 测试范围：URL、PRD、分支、focus。
- 用例列表：状态、优先级、耗时。
- 失败详情：预期、实际、复现步骤。
- 证据区：截图、Console、Network、页面模型。
- 回归影响区：每个影响点是否覆盖。
- 回放区：replay 文件和 case 文件路径。

## 回放查看方式

`replay.json` 是机器可执行格式，不应该要求用户直接阅读 JSON。最终需要提供三种查看方式。

### 1. 报告内查看

`report.html` 中内置回放时间线。

用户打开报告后可以看到：

- 每个测试 case 的步骤列表。
- 每一步的操作类型，例如打开页面、点击、输入、等待、断言、截图。
- 每一步的目标元素，例如按钮文本、输入框 placeholder、aria label。
- 每一步的执行状态、耗时和错误信息。
- 每一步关联的截图。
- 失败步骤的 Console、Network、页面模型证据。

示例展示：

```text
退款主流程

1. 打开 /orders/123                      通过  820ms
2. 点击「申请退款」                       通过  310ms
3. 在「退款金额」输入框输入 10             通过  190ms
4. 点击「提交」                           通过  420ms
5. 断言页面出现「退款中」                  失败  5000ms

失败证据：
- 截图：screenshots/refund-main-flow-step-5-fail.png
- Console：无错误
- Network：POST /api/refund 返回 200
- 页面实际文本：退款申请已提交
```

### 2. 独立 Replay Viewer

除了报告，还可以生成一个独立查看器：

```text
.browser-bridge/runs/refund-flow/replay-viewer.html
```

这个 HTML 读取同目录下的 `replay.json`、`summary.json` 和 screenshots，展示一条可浏览的回放时间线。

功能建议：

- 左侧 case 列表。
- 中间步骤时间线。
- 右侧步骤详情。
- 点击步骤时显示对应截图。
- 支持筛选失败步骤。
- 支持复制某个 case 的复现步骤。
- 支持查看原始 JSON。

### 3. 命令/工具查看

新增 `browser_qa_report` 时支持把 replay 渲染成人类可读格式：

```json
{
  "runDir": ".browser-bridge/runs/refund-flow",
  "format": "html"
}
```

或者：

```json
{
  "runDir": ".browser-bridge/runs/refund-flow",
  "format": "markdown"
}
```

这样用户不需要打开 JSON，只看报告即可。

### Replay JSON 的定位

`replay.json` 只承担两个职责：

- 给 `browser_qa_replay` 执行回放。
- 给报告/查看器渲染步骤时间线。

人看的主要入口是：

```text
report.html
report.md
replay-viewer.html
```

机器执行入口是：

```text
replay.json
```

## 录制功能完善计划

当前录制能力已经从雏形升级为可用于 QA case 生成的基础能力：

- `browser_toggle_recording` 可以开启/关闭录制。
- `browser_get_recorded_steps` 可以取回录制步骤。
- `browser_qa_from_recording` 可以清洗录制步骤并生成 `recorded-case.json` / `replay.json`。
- Content script 当前监听 `click`、`input`、`change`、`keydown`、`submit`、`scroll` 和 URL change。
- 录制步骤会保存 text、role、ariaLabel、placeholder、selector、selectorHint、testId、nearText、rect、url、title 等信息。
- password、token、验证码等敏感输入默认脱敏。

仍可继续增强的部分包括：更强的业务断言补全、Popup 中的录制步骤预览、暂停/继续、导出按钮，以及基于页面模型的完整自愈。

### 1. 录制数据结构标准化

当前录制步骤应升级为稳定 schema：

```ts
export type RecordedStep = {
  id: string;
  timestamp: number;
  action: "open" | "click" | "type" | "select" | "check" | "uncheck" | "pressKey" | "scroll" | "waitFor";
  url: string;
  title?: string;
  target?: {
    text?: string;
    role?: string;
    ariaLabel?: string;
    placeholder?: string;
    selector?: string;
    selectorHint?: string;
    elementId?: string;
    testId?: string;
    nearText?: string;
  };
  value?: string;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  frame?: {
    frameId?: number;
    url?: string;
  };
};
```

### 2. 增强录制事件

已覆盖：

- `input`：记录真实输入变化，但要 debounce，避免每个字符都记录。
- `keydown`：记录 Enter、Escape、Tab、ArrowUp、ArrowDown 等关键按键。
- `submit`：记录表单提交。
- `scroll`：记录明显滚动，按距离阈值合并。
- `select`：记录下拉选择。
- checkbox/radio：记录 check/uncheck，而不是普通 click。
- URL change：SPA 路由变化时插入 `waitFor` 或 `open` 语义步骤。

### 3. 选择器稳定性策略

录制时不要只存 CSS selector。每个目标需要保存多种定位线索，回放时按稳定性排序：

1. `data-testid`
2. `aria-label`
3. role + accessible name
4. placeholder
5. button/link/input 文本
6. label 关联文本
7. nearText
8. selectorHint
9. CSS selector
10. 坐标兜底，仅用于诊断，不作为默认回放方式

### 4. 录制步骤清洗

已新增 `recorder.ts` 做基础清洗：

- 合并连续输入，只保留最终值。
- 合并连续滚动。
- 去掉无意义点击，例如点击空白区域。
- 将 checkbox/radio click 转成 `check` / `uncheck`。
- 将 select change 转成 `select`。
- 插入必要等待，例如点击后 URL 改变则插入 `waitFor`。
- 将录制步骤转换为 `browser_run_steps` 可执行步骤。

后续增强：

- 为每步生成更自然的业务描述。
- 根据最终页面状态自动补充断言。

示例：

```json
{
  "action": "type",
  "description": "在退款金额输入框中输入 10",
  "target": {
    "placeholder": "退款金额",
    "role": "textbox"
  },
  "value": "10"
}
```

### 5. 录制转用例

已新增 `browser_qa_from_recording`：把用户手工录制流程转成 QA case。

流程：

```text
开启录制
  -> 用户手工走一遍流程
  -> 停止录制
  -> 清洗步骤
  -> 可由 AI 根据最后页面状态补充断言
  -> 生成 case.json 和 replay.json
```

例如用户走完“退款成功”流程后，AI 自动补断言：

- 页面出现“退款中”
- 订单状态变更
- POST /refund 接口成功

### 6. 回放稳定性

回放时需要做三层策略：

第一层：严格定位。

- 使用录制的 `data-testid`、aria、placeholder、text。

第二层：语义重定位。

- 当前 smart replay 会补充 query、visibleOnly 和 timeout，让浏览器端查找更宽容。
- 后续可在目标找不到时调用 `browser_observe` / `browser_get_page_model`，再根据步骤描述重新匹配最接近元素。

第三层：失败诊断。

- 不直接坐标点击。
- 保存截图、页面模型、候选元素列表。
- 报告中提示“疑似 UI 文案或结构变化”。

### 7. 录制隐私和安全

录制可能包含密码、token、手机号等敏感信息，需要默认脱敏：

- password 输入框不记录真实值。
- 支持字段级 mask。
- 报告中隐藏敏感 value。
- `credentialsRef` 只引用凭据，不把凭据写入 replay。

示例：

```json
{
  "action": "type",
  "target": { "placeholder": "密码" },
  "valueRef": "credentials.seller.password",
  "masked": true
}
```

### 8. 录制 UI

Popup 当前已有录制入口，后续可以增强：

- 显示当前录制步数。
- 显示最近 3 条步骤。
- 支持暂停/继续。
- 支持导出 replay。
- 支持清空。
- 支持“发送给 AI 生成测试用例”。

## 开发阶段

### 阶段 1：QA Artifacts 和报告 MVP

状态：已完成。

目标：先跑起来，能输出测试报告。

任务：

- 新增 `packages/mcp-server/src/qa/types.ts`。
- 新增 artifacts 保存器。
- 新增 Markdown 报告生成器。
- 新增 `browser_qa_run`，先支持直接传 steps。
- 每个 case 保存结果、截图和 summary。
- 输出 `report.md` 和 `summary.json`。

验收：

- 用户传 URL 和 steps，可以自动执行。
- 失败时有截图和复现步骤。
- 本地生成 `.browser-bridge/runs/{taskId}`。

### 阶段 2：Replay 标准化

状态：已完成。

目标：测试结果可回放。

任务：

- 定义 `replay.json` schema。
- 新增 `browser_qa_replay`。
- 支持 strict 回放。
- 支持 case 级别单独回放。
- 报告中展示 replay 路径。

验收：

- 第一次 QA run 生成 replay。
- 第二次可通过 replay 复跑同一流程。

### 阶段 3：录制能力完善

状态：基础能力已完成，Popup 交互增强待继续。

目标：用户手工操作可以转成稳定测试脚本。

任务：

- 扩展 content script 录制事件。
- 标准化 `RecordedStep`。
- 新增步骤清洗和合并。
- 支持录制转 replay。
- 支持录制转 QA case。
- 增加敏感字段脱敏。

验收：

- 用户手工走一遍流程。
- AI 可以生成可读、可回放的 case。
- 输入、选择、滚动、按键、路由变化都能合理记录。

### 阶段 4：PRD 和代码分支理解

状态：本地启发式版本已完成，LLM 深度理解待上层 Agent 或后续集成。

目标：AI 根据需求和代码变化自动规划测试范围。

任务：

- 支持读取 `prdPath` / `prdText`。
- 支持读取 git diff。
- 推断变更模块、路由、接口和共享组件。
- 生成主流程、异常流程、回归影响点。
- 输出 `browser_qa_plan`。

验收：

- 用户只给 PRD、分支和 URL，也能生成测试计划。
- 报告中说明为什么测试这些点。

### 阶段 5：智能回放和自愈

状态：smart replay 参数增强已完成，完整自愈待继续。

目标：UI 有轻微变化时，回放不轻易失败。

任务：

- 新增 smart replay。
- 元素找不到时读取页面模型。
- 根据步骤描述和目标语义重新定位。
- 报告中记录自愈行为。

验收：

- 按钮文案或 DOM 层级轻微变化，回放仍可执行。
- 自愈失败时报告给出候选元素和差异原因。

### 阶段 6：HTML 报告和 CI 集成

状态：HTML 报告、Replay Viewer、CI Summary 已完成；PR 评论和失败阈值待继续。

目标：可用于团队协作和 PR 流程。

任务：

- 新增 HTML 报告模板。
- 支持 PR 评论摘要。
- 支持 CI artifact。
- 支持失败阈值。
- 支持多角色、多环境配置。

验收：

- 报告可直接发给研发/测试/产品。
- CI 中能产出可下载 artifacts。

## MVP 推荐范围

第一版不要做太大，建议只做：

- `browser_qa_run`
- steps 输入
- case 执行
- 截图保存
- console/network 简单采集
- `summary.json`
- `report.md`
- `replay.json`

第一版完成后，用户已经可以实现：

```text
AI 开发完功能
  -> 打开测试环境
  -> 自动走核心流程
  -> 断言结果
  -> 失败截图
  -> 输出报告
  -> 保存回放
```

之后再逐步补 PRD 分析、git diff、录制增强、智能回放和 HTML 报告。
