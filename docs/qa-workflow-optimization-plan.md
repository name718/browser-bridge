# Browser Bridge QA 流程优化计划

## 背景

当前 Browser Bridge 已经具备完整的 scripted QA 基础能力：

- `browser_qa_plan`：基于 PRD、focus、branch diff 生成启发式测试计划。
- `browser_qa_run`：执行结构化用例并生成报告、回放和 CI 摘要。
- `browser_qa_from_recording`：把用户录制步骤清洗为 QA case。
- `browser_qa_replay`：回放已生成的 replay。
- `browser_qa_report`：重建 Markdown、HTML、Replay Viewer 或 CI Summary。

当前主要问题不是缺少单点工具，而是流程控制、失败诊断、用例资产和报告决策信息还不够稳定。优化目标是把“能跑”提升为“可控、可审、可复盘、可持续维护”。

## 目标

1. 降低无效执行：环境、登录态、目标页面不可用时，提前阻塞并给出明确原因。
2. 提升失败可诊断性：失败时自动保存足够的页面、console、network、locator 和步骤上下文。
3. 提升用例可维护性：语义用例与可执行用例分离，并保留版本化产物。
4. 提升报告可决策性：明确失败分类、风险等级、证据链接和开发缺口。
5. 提升重跑稳定性：smart replay 能在不改变业务断言的前提下进行有限自愈。

## 非目标

- 不把 Browser Bridge 改造成传统 E2E 框架。
- 不要求业务项目接入专用 SDK 或构建插件。
- 不在 Chrome extension 中塞入复杂 QA 编排逻辑。
- 不默认跳过人工确认门，尤其是涉及登录态、支付、删除、提交等敏感操作时。

## 当前状态

### 已完成

#### 执行前预检

`browser_qa_run` 已新增 `preflight` 配置，默认执行轻量连接检查。

支持项：

- `enabled`
- `requireConnected`
- `requireActiveTab`
- `checkBaseUrlReachable`
- `failOnExistingConsoleError`

行为：

- 预检失败时，不继续执行用例步骤。
- 所有用例标记为 `blocked`。
- 错误码为 `PREFLIGHT_FAILED`。
- 失败分类为 `environment_error`。
- 预检详情写入 `diagnostics/preflight.json`。
- `summary.json`、`report.md`、`report.html`、`ci-summary.json` 展示预检结果。

验证：

- `pnpm test tests/unit/qa-tools.test.ts`
- `pnpm --filter @majuntao-1/browser-bridge-mcp-server typecheck`

## 分阶段计划

### 阶段 1：流程门禁与运行前安全

目标：让 QA 执行有明确阶段、确认门和阻塞原因。

任务：

- 固化 scripted QA 阶段状态：
  - `init`
  - `fetch_prd`
  - `confirm_requirement`
  - `analyze_impact`
  - `confirm_impact`
  - `generate_semantic_cases`
  - `confirm_cases`
  - `generate_executable_cases`
  - `confirm_executable`
  - `run`
  - `confirm_result`
  - `report`
- 将阶段状态保存为运行产物，例如 `workflow-state.json`。
- 为 `browser_qa_run` 的预检补充更明确的 blocked 分类：
  - Browser Bridge 未连接
  - 无活动标签页
  - baseUrl 不可达
  - 页面已有启动级 console error
  - 缺少登录态或权限
- 在报告中突出“未执行”和“执行失败”的差异。

验收标准：

- 任一预检失败不会触发业务步骤。
- 报告中能明确看到阻塞原因和未执行用例。
- CI summary 能区分 `failed` 与 `blocked`。

### 阶段 2：失败诊断包增强

目标：每个失败用例都能直接支持复现和定位。

任务：

- 扩展 diagnostics JSON，固定包含：
  - case id / step index / action
  - 当前 URL 和 title
  - 失败步骤原始参数
  - 规范化 locator
  - 匹配候选元素列表
  - 相关 DOM 片段或 page model
  - failure screenshot
  - console summary
  - network summary
  - 最近步骤 timeline
- 对不同失败分类补充不同证据：
  - `selector_failed`：候选元素、locator、nearText、page model
  - `assertion_failed`：实际页面文本、断言目标、截图
  - `console_error`：错误堆栈和首个错误时间
  - `network_error`：失败接口、状态码、耗时
  - `environment_error`：预检项和连接状态
- 报告 HTML 中新增“诊断摘要”区域，避免只给 JSON 链接。

验收标准：

- 失败用例的 `diagnostics/{caseId}.json` 可独立用于复盘。
- HTML 报告无需打开 JSON 也能看到主要失败原因。
- 单测覆盖 selector、assertion、console、network、environment 五类失败。

### 阶段 3：Locator 标准化与可观测性

目标：减少脆弱选择器，并让定位失败可解释。

推荐 locator 优先级：

```text
data-testid
  -> role + name
  -> label / ariaLabel
  -> placeholder
  -> text + nearText
  -> stable CSS selector
  -> visual fallback
```

任务：

- 定义 `locatorStrategy` 元数据，记录每一步最终使用的定位策略。
- 在 `normalizeStepLocators` 中补充策略解释，不只补全字段。
- 报告中展示每个失败步骤的 locator 策略。
- 对 raw CSS selector 增加风险提示。
- 对缺少稳定 locator 的可执行用例给出 warning。

验收标准：

- 每个 click/type/waitFor/assertText 步骤都有可追踪 locator 信息。
- 报告能区分“页面无目标元素”和“locator 太脆弱”。
- 单测覆盖 `testId`、`role+text`、`placeholder`、`selector fallback`。

### 阶段 4：语义用例与可执行用例资产分离

目标：让测试范围可审查，执行脚本可维护。

任务：

- 生成并保存以下产物：
  - `requirement-summary.json`
  - `impact-analysis.json`
  - `semantic-cases.json`
  - `executable-cases.json`
  - `run-config.json`
- 语义用例只描述业务步骤、前置条件、期望结果和风险来源。
- 可执行用例保存 Browser Bridge steps、locator、observe、diagnostics 配置。
- replay 继续只保存可回放执行数据。

验收标准：

- 产品/QA 可以只审 `semantic-cases.json`。
- 前端/测试工程师可以只审 `executable-cases.json`。
- 每个 executable case 能追溯到 semantic case id。

### 阶段 5：录制转用例增强

目标：把“人工走一遍主流程”变成推荐的低风险入口。

任务：

- 增强 `browser_qa_from_recording` 输出：
  - 语义步骤草稿
  - 可执行步骤
  - 自动脱敏说明
  - 建议补充的业务断言
- 对录制步骤进行稳定 locator 提升：
  - `testId`
  - role
  - label
  - placeholder
  - nearText
  - selectorHint
- 支持 `run=false` 默认只生成产物，不立即执行。

验收标准：

- 录制产物可直接进入人工确认。
- 敏感输入不会出现在报告或 replay 中。
- 录制主流程可转换为至少一个 P0 case。

### 阶段 6：报告产品化

目标：报告能直接支持发布决策和问题分派。

报告结构：

```text
结论
测试范围
执行前预检
用例结果
失败问题
阻塞原因
回归风险
截图证据
Console 摘要
Network 摘要
Replay 链接
开发缺口
```

失败分类标准：

```text
product_bug
frontend_bug
backend_or_data
environment_blocked
locator_flaky
test_case_invalid
unknown
```

任务：

- 将现有技术分类映射到面向决策的分类。
- CI summary 输出失败分类统计。
- HTML 报告新增失败聚合视图。
- 报告中明确列出证据缺口，例如未采集 network 或 page model。

验收标准：

- 报告首页能看出是否建议发布。
- 每个失败项都有分类、证据和复现步骤。
- CI summary 可被流水线或 PR 评论消费。

### 阶段 7：Smart Replay 自愈增强

目标：在不改变测试意图的前提下，提高失败用例重跑成功率。

任务：

- locator 失败后读取 page model，重新匹配候选元素。
- 文案轻微变化时，降级使用 role、nearText、placeholder。
- DOM click 失败时，自动尝试 CDP input 或 visual fallback。
- 每次自愈都记录：
  - 原 locator
  - 新 locator
  - 自愈原因
  - 置信度
  - 是否改变业务语义
- 只重跑失败/阻塞 case，不默认整批重跑。

验收标准：

- smart replay 的自愈过程写入 diagnostics。
- 自愈不能静默改变断言目标。
- 单测覆盖 locator 替换、视觉 fallback 和不可自愈场景。

## 建议实施顺序

1. 失败诊断包增强。
2. Locator 标准化与报告展示。
3. 语义用例和可执行用例资产分离。
4. 报告产品化。
5. 录制转用例增强。
6. Smart replay 自愈增强。
7. 阶段状态机持久化。

其中预检能力已完成，可作为阶段 1 的第一项交付。

## 风险与控制

### 风险 1：流程过重，影响快速调试

控制：

- 保留低层 `browser_*` 实时操作能力。
- `browser_qa_run` 支持直接传入 `steps` 的轻量模式。
- 阶段门主要放在 skill workflow，而不是强制所有底层工具。

### 风险 2：自动诊断采集成本过高

控制：

- 默认只在失败时采集重证据。
- `observe.final` 和 `observe.onFailure` 可配置。
- 大型 page model 设置 token/元素数量上限。

### 风险 3：Smart replay 静默改变测试语义

控制：

- 自愈必须记录 diff 和置信度。
- 对断言步骤使用更严格策略。
- 无法证明语义一致时标记为 blocked，而不是自动通过。

### 风险 4：报告分类误导决策

控制：

- 区分技术失败分类和产品化失败分类。
- 分类不确定时使用 `unknown`。
- 报告中保留原始错误和证据链接。

## 验证策略

每个阶段至少包含：

- 单元测试：覆盖数据模型、分类、报告渲染和边界条件。
- 类型检查：`pnpm --filter @majuntao-1/browser-bridge-mcp-server typecheck`。
- 端到端烟测：使用本地 fixture 或简单页面执行 `browser_qa_run`。
- 报告人工检查：确认 HTML 报告可读、链接可打开、证据完整。

## 近期下一步

建议下一步优先开发“失败诊断包增强”：

1. 扩展 diagnostics JSON schema。
2. 捕获失败步骤上下文和 locator 信息。
3. 报告中展示诊断摘要。
4. 为主要失败分类补单测。

