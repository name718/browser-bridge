# Browser Bridge Scripted QA 技术方案与开发计划

## 背景

当前 Browser Bridge 已经支持 Agent 实时操作真实 Chrome，包括页面观察、元素查找、点击输入、截图、Console/Network 采集、QA 用例执行和 HTML 报告生成。

但在复杂页面测试中，完全依赖 Agent 实时操作存在明显性能问题：

- 每一步都需要 Agent 观察页面、推理下一步、再调用工具。
- 页面快照、截图、DOM 模型会反复传回 Agent，token 和时间成本高。
- Agent 缺少源码上下文时，只能按页面表现猜测控件和断言点。
- 失败后才补充采集证据，排查链路长且不可复现。

因此需要把 Browser Bridge 的产品目标收敛为自动化测试执行引擎：Agent 负责理解需求、分析源码、生成测试脚本和解释结果；Browser Bridge 负责稳定、快速、批量执行脚本并采集证据。

```text
Agent 先读源码和分支 diff 生成测试脚本
  -> Browser Bridge 批量执行脚本
  -> 执行器自动采集页面状态、截图、Console、Network
  -> Agent 基于产物分析结果和失败原因
```

## 目标

改造后，Browser Bridge 的核心目标是 Scripted QA。

Scripted QA 适用于分支回归、PRD 验收、主链路 smoke、批量测试、CI 前置验证。

```text
Agent 分析源码和 diff
Agent 生成语义用例和可执行脚本
Browser Bridge 一次性批量执行
失败时自动诊断
最终生成报告
```

原有实时操作能力可以作为底层调试能力保留，也可以在实现过程中被改造为 QA runner 的内部能力；不再作为第一优先级兼容目标。

## 非目标

第一阶段不做以下事情：

- 不要求业务项目必须接入 webpack/Vite 插件。
- 不做完整视觉 diff。
- 不做跨浏览器执行。
- 不把 Browser Bridge 改造成传统 E2E 框架。
- 不在 Chrome extension 中实现复杂 QA 编排逻辑。
- 不保证所有旧的实时操作交互语义完全不变。

## 总体架构

```text
User
  |
  | 提供 branch / baseBranch / baseUrl / PRD / focus
  v
Agent Skill Workflow
  |
  | 读取源码、git diff、路由、组件、API、表单和断言点
  v
Semantic Test Cases
  |
  | 转换为可执行脚本
  v
browser_qa_run
  |
  | 批量执行、观察策略、失败诊断、产物保存
  v
MCP Server QA Runner
  |
  v
Browser Bridge Daemon
  |
  v
Chrome Extension
  |
  v
Real Browser Page
```

分层职责：

- Skill：定义 Agent 工作流、阶段门禁、用例格式、脚本生成规则、报告输出要求。
- MCP Server QA 层：执行脚本、采集证据、生成 summary/report/replay。
- Extension Background：转发工具调用、控制 tab、执行 CDP、处理安全策略。
- Content Script：页面内 DOM 观察、元素定位、点击输入、断言、录制。

## 默认工作流

Skill 中应把 Scripted QA 作为默认工作流。

触发条件：

- 用户给分支、PRD、测试环境，要求回归或验收。
- 用户要求“生成测试用例”“生成测试脚本”“批量测试”“输出报告”。
- 用户要求 Agent 自测某个功能或页面。
- 目标是可复现、可保存、可回放的测试过程。

只有在脚本执行失败、选择器无法稳定定位、页面状态未知时，才允许 Agent 进入临时探索模式补充观察，并把观察结果反写到脚本或诊断报告中。

## 核心数据模型

### 语义测试用例

语义用例用于人审，不包含过多选择器细节。

```json
{
  "id": "refund-happy-path",
  "title": "用户可以提交合法退款金额",
  "priority": "P0",
  "route": "/order/refund",
  "riskSource": [
    "src/pages/order/refund.vue"
  ],
  "preconditions": [
    "用户已登录",
    "订单状态允许退款"
  ],
  "steps": [
    "打开退款页面",
    "输入合法退款金额",
    "点击提交",
    "确认页面出现退款中状态"
  ],
  "expected": [
    "提交按钮可点击",
    "退款接口成功",
    "页面展示退款中"
  ]
}
```

### 可执行测试脚本

可执行脚本面向 Browser Bridge 执行器。

```json
{
  "id": "refund-happy-path",
  "title": "用户可以提交合法退款金额",
  "priority": "P0",
  "trace": {
    "semanticCaseId": "refund-happy-path",
    "riskSource": [
      "src/pages/order/refund.vue"
    ]
  },
  "steps": [
    {
      "action": "open",
      "url": "{{baseUrl}}/order/refund?orderId=123"
    },
    {
      "action": "type",
      "locator": {
        "testId": "refund-amount",
        "label": "退款金额",
        "placeholder": "退款金额"
      },
      "value": "10.00",
      "replace": true
    },
    {
      "action": "click",
      "locator": {
        "role": "button",
        "text": "提交"
      }
    },
    {
      "action": "assertText",
      "contains": "退款中"
    }
  ],
  "observe": {
    "before": [
      "pageModel"
    ],
    "afterEachStep": false,
    "onFailure": [
      "screenshot",
      "console",
      "network",
      "pageModel"
    ],
    "final": [
      "screenshot",
      "console"
    ]
  },
  "diagnostics": {
    "failOnConsoleError": true,
    "failOnUncaughtException": true,
    "failOnNetworkError": true,
    "slowRequestThresholdMs": 1000
  }
}
```

### Locator

新增统一 locator，作为测试脚本的主定位协议。现有 `text`、`selector`、`placeholder` 等字段可以在迁移期转换为 locator。

```ts
export type BrowserLocator = {
  testId?: string;
  selector?: string;
  role?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
  href?: string;
  nearText?: string;
  visibleOnly?: boolean;
  viewportOnly?: boolean;
};
```

定位优先级：

```text
testId 精确匹配
selector
label -> input/control
role + text
aria-label
placeholder
href
text
nearText
视觉定位兜底
```

## 源码与分支分析

Scripted QA 的关键不是让 Agent 盲猜页面，而是让 Agent 先分析代码。

输入：

```json
{
  "baseBranch": "master",
  "targetBranch": "feature/refund-flow",
  "baseUrl": "https://staging.example.com",
  "prdText": "...可选...",
  "focus": [
    "退款流程",
    "金额校验"
  ]
}
```

Agent 应分析：

- git diff 文件列表和具体变更。
- 变更页面、路由、组件、表单字段、按钮。
- API 调用、请求参数、错误处理。
- store/state、权限、feature flag。
- 受影响的老功能和回归路径。
- 可用选择器和稳定定位线索。

输出影响面：

```json
{
  "changedFiles": [],
  "affectedRoutes": [],
  "affectedComponents": [],
  "affectedApis": [],
  "riskPoints": [],
  "regressionAreas": [],
  "selectorHints": []
}
```

## 执行与观察策略

脚本执行器应避免每步重观察。

默认策略：

- 正常步骤只保存轻量状态。
- 每个 case 开始可选保存一次 `pageModel`。
- 失败时自动保存截图、页面模型、Console、Network。
- case 结束保存 final screenshot 和 console summary。
- 大对象写入 artifact 文件，MCP 响应只返回摘要和路径。

失败诊断产物：

```json
{
  "caseId": "refund-happy-path",
  "failedStep": "click-submit",
  "errorCode": "ELEMENT_NOT_FOUND",
  "screenshotPath": "screenshots/refund-happy-path-failure.png",
  "pageModelPath": "page-models/refund-happy-path-failure.json",
  "consoleErrors": [],
  "failedRequests": [],
  "candidates": [
    {
      "role": "button",
      "text": "确认提交",
      "confidence": 0.72
    }
  ]
}
```

失败类型归因：

```text
selector_failed
assertion_failed
console_error
network_error
test_data_error
auth_error
environment_error
unknown
```

## 产物目录

```text
.browser-bridge/runs/{taskId}/
  impact-report.json
  semantic-cases.json
  executable-cases.json
  summary.json
  ci-summary.json
  replay.json
  replay-viewer.html
  report.md
  report.html
  cases/
  screenshots/
  logs/
    console.json
    network.json
  page-models/
  diagnostics/
```

## Skill 改造方案

更新现有 skill：

```text
packages/skills/browser-bridge-ai-qa/SKILL.md
```

新增 Scripted QA 工作流章节：

```text
1. Branch/source analysis
2. Semantic case generation
3. Executable script generation
4. Batch execution
5. Evidence collection
6. Result analysis
7. HTML report
```

新增 reference：

```text
packages/skills/browser-bridge-ai-qa/references/scripted-qa-workflow.md
packages/skills/browser-bridge-ai-qa/references/scripted-case-format.md
packages/skills/browser-bridge-ai-qa/references/locator-strategy.md
```

Skill 只负责 Agent 编排，不承载核心执行逻辑。

## MCP 改造方案

优先重构 `browser_qa_run` 为脚本化测试执行入口。可以破坏式调整内部实现和返回结构，但要保留清晰的 MCP 输入输出契约。

### `browser_qa_run` 增强

新增字段：

```ts
type QaRunInput = {
  observe?: QaObservePolicy;
  diagnostics?: QaDiagnosticsPolicy;
};

type QaObservePolicy = {
  before?: Array<"screenshot" | "console" | "network" | "pageModel">;
  afterEachStep?: boolean;
  onFailure?: Array<"screenshot" | "console" | "network" | "pageModel">;
  final?: Array<"screenshot" | "console" | "network" | "pageModel">;
};

type QaDiagnosticsPolicy = {
  failOnConsoleError?: boolean;
  failOnUncaughtException?: boolean;
  failOnNetworkError?: boolean;
  slowRequestThresholdMs?: number;
};
```

步骤 schema 新增：

```ts
locator?: BrowserLocator;
```

迁移逻辑：

- 有 `locator` 时优先使用。
- 没有 `locator` 时，把现有 `text`、`selector`、`placeholder`、`role` 字段标准化为 locator。
- 新产物统一写入 executable cases，不再鼓励手写零散 browser 工具调用。

### 后续可选工具

当第一阶段稳定后，再考虑新增：

```text
browser_qa_analyze_branch
browser_qa_generate_scripts
browser_qa_script_run
```

第一版不建议在 MCP server 内实现完整 `browser_qa_from_branch`。分支理解仍由 Agent/Skill 完成，MCP server 聚焦执行、采证、报告。

## Extension 改造方案

### Content Script

新增统一定位函数：

```ts
resolveLocator(locator: BrowserLocator): BrowserElement | null
```

增强元素索引字段：

```text
data-testid
data-test
data-cy
id
name
role
text
aria-label
placeholder
label text
href
selectorHint
nearText
rect
visible
disabled
```

找不到元素时返回候选元素：

```json
{
  "matched": false,
  "candidates": [
    {
      "elementId": "bb-123",
      "role": "button",
      "text": "确认提交",
      "confidence": 0.72,
      "reasons": [
        "text similar to 提交"
      ]
    }
  ]
}
```

### Background

继续保持分发职责，不放复杂 QA 编排。

需要确认：

- `browser_click`、`browser_type`、`browser_find`、`browser_wait_for` 支持 `locator` 参数。
- 对高风险点击继续执行现有安全策略。
- Console/Network 采集能力可按 case 生命周期启动和停止。

## Instrumentation 插件策略

第一阶段不强制写 webpack 插件。

原因：

- 多数页面可以先通过 `data-testid`、label、role、text、placeholder 定位。
- 构建插件会引入业务接入成本。
- 当前优先验证脚本化 QA 的速度和稳定性收益。

第二阶段可做可选增强：

```text
@browser-bridge/instrumentation
  vite plugin
  webpack plugin
  babel plugin
```

仅在测试环境开启，注入：

```html
data-bb-source="src/pages/refund/index.vue:42"
data-bb-component="RefundForm"
data-bb-model="form.amount"
data-bb-testid="refund-form.amount"
```

要求：

- 不进入生产构建。
- 不改变业务逻辑。
- 支持 include/exclude。
- 支持 Vue/React 主流写法。

## 开发计划

### Phase 0：方案与格式冻结

交付：

- 本技术方案评审完成。
- 确认 scripted case schema。
- 确认 observe/diagnostics policy。
- 确认 skill 工作流和阶段门禁。

验收：

- 能用文档中的 JSON 手写一个 scripted case。
- 团队确认第一阶段不强制 instrumentation。

### Phase 1：重构 QA Runner

改动：

- 重构 `packages/mcp-server/src/qa/qa-tools.ts` 中的 `browser_qa_run`。
- 将 `browser_qa_run` 定位为脚本化测试执行入口。
- 扩展 `packages/mcp-server/src/qa/types.ts`，定义 executable case、observe policy、diagnostics policy、failure category。
- 让执行结果优先写 artifact 文件，MCP 响应只返回摘要和路径。

验收：

- `browser_qa_run` 可以接收 executable cases 并批量执行。
- 大对象不会直接塞进 MCP 响应。
- 每个 case 有稳定的 summary、steps、artifacts、failureCategory。

### Phase 2：统一 Locator

改动：

- `shared` 增加 `BrowserLocator` 类型。
- `browser_qa_run` step schema 支持 `locator`。
- content script 实现 `resolveLocator`。
- click/type/wait/find/assert 接入 locator。
- 旧字段在执行前统一转换为 locator。

验收：

- 支持 `testId`、`label`、`role + text`、`placeholder` 定位。
- 找不到元素时返回候选元素。
- 新生成脚本默认使用 locator。

### Phase 3：观察策略与失败诊断

改动：

- 实现 `observe` 和 `diagnostics`。
- case 开始前启动 Console/Network 监听。
- 失败时自动采集 screenshot/pageModel/console/network。
- 报告中展示诊断产物路径和摘要。
- 根据错误、控制台、网络、页面状态生成 failure category。

验收：

- 执行一个 case 时，正常路径不每步截图。
- 失败时自动保存完整诊断证据。
- `summary.json` 能标记失败类型。
- console/network 采集窗口覆盖 case 生命周期。

### Phase 4：Skill 与分支脚本生成工作流

改动：

- 更新 `packages/skills/browser-bridge-ai-qa/SKILL.md`。
- 新增 scripted QA reference 文档。
- 明确 Scripted QA 是默认自动化测试工作流。
- Skill 增加 branch-aware scripted QA 流程。
- 约定 `impact-report.json`、`semantic-cases.json`、`executable-cases.json`。
- Agent 根据 diff 生成测试用例和脚本。

验收：

- 用户提供 `baseBranch`、`targetBranch`、`baseUrl` 后，Agent 能输出影响面分析。
- Agent 能生成 P0/P1/P2 语义用例。
- Agent 能把语义用例转换成 executable cases。
- 用户确认后才执行浏览器测试。
- Agent 不会直接跳到实时浏览器操作。

### Phase 5：报告增强

改动：

- `report.html` 展示影响面、用例来源、执行结果、失败归因、截图、Console、Network。
- `ci-summary.json` 加入 failure category。
- Replay viewer 可按新 executable case 格式调整。

验收：

- 报告能回答“测了什么、为什么测、结果如何、证据在哪里、失败可能原因是什么”。
- 失败用例可以从报告直接定位到截图和日志。

### Phase 6：可选 Instrumentation

前置条件：

- Scripted QA 已经证明能提速。
- 业务项目出现大量定位不稳定问题。

交付：

- Vite 插件 MVP。
- Webpack 插件或 Babel 插件。
- 测试环境注入 `data-bb-*`。

验收：

- 测试环境 DOM 能映射源码位置。
- 生产构建不包含注入属性。
- Agent 生成的脚本定位稳定性明显提升。

## 风险与对策

### 选择器不稳定

对策：

- 多 locator 候选。
- 候选元素返回。
- 优先 `data-testid`、label、role。
- 后续 optional instrumentation。

### Agent 生成脚本质量不稳定

对策：

- 先输出语义用例供人审。
- 脚本生成保留 trace 信息。
- 执行失败返回可修正的候选元素和诊断证据。

### 采集证据过重

对策：

- 默认只在失败和 final 采集。
- 大对象落盘，响应只返回摘要。
- 提供 `summaryOnly`。

### Console/Network 生命周期不完整

对策：

- 在 case 开始前启动监听，case 结束后停止。
- 报告中明确采集窗口。
- 无法采集时标记为 gap。

### 认证态和测试数据不稳定

对策：

- 使用用户真实 Chrome session。
- case 支持 preconditions。
- 报告中区分 auth/test data/environment failure。

## 验收标准

第一阶段完成后，应满足：

- Scripted QA 可以从 approved executable cases 批量执行。
- 单个 case 正常路径减少 Agent 往返调用。
- 失败时自动保存截图、pageModel、Console、Network。
- 报告能展示 scripted case、执行步骤、失败归因和证据路径。
- Skill 能指导 Agent 先分析源码和分支，再生成用例和脚本。
- 原有实时操作能力即使被调整，也不影响自动化测试主流程。

## 推荐落地顺序

```text
1. 重构 browser_qa_run 为脚本化测试执行入口
2. 增加 locator 字段和运行时定位引擎
3. 实现 observe/diagnostics 与失败诊断采集
4. 更新 skill 和 scripted QA reference
5. 完成 branch-aware 脚本生成工作流
6. 增强 HTML 报告和 failure category
7. 视定位稳定性决定是否做 instrumentation
```

这个顺序优先把 Browser Bridge 改造成自动化测试执行引擎，先解决脚本执行、定位、采证和报告闭环，再补 Agent 工作流和可选构建期增强。
