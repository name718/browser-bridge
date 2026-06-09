# Browser Bridge AI 自动化测试优化执行方案

## 📊 项目现状分析

### 1. 项目概况
**Browser Bridge** 是一个通过 MCP 协议让 AI Agent 操控真实 Chrome 浏览器的自动化测试框架。

**架构组成：**
- **Chrome Extension** (~6,842 行代码) - Manifest V3，负责浏览器端操作
- **MCP Server** (~4,448 行代码) - 当前 `browser_*` 工具约 67 个（以 `packages/mcp-server/src/tools/browser-tools.ts` 中注册项为准）
- **WebSocket Bridge** - 连接 MCP Server 和 Chrome Extension
- **QA 模块** - 已实现基础的测试编排功能

### 2. 核心痛点（已验证）

#### 痛点 1：执行效率低下 ⚠️
**现状：** 
- 简单的"填表→查询"流程需要 **8-12 次 MCP 往返**
- 每次往返耗时：网络通信 + AI 推理 = **1-2秒**
- 总耗时：**15-25秒** 完成 3 个字段的填表任务

**代码证据：**
```typescript
// packages/mcp-server/src/tools/browser-tools.ts
// 当前模式：每个操作都是独立的工具调用
browser_find → browser_click → browser_type → browser_find → ...
```

#### 痛点 2：元素定位不准确 ❌
**现状：**
- `scoreElements()` 函数以通用文本匹配为主（见 content.ts:1825-1928）
- 已有内联中文同义词表与 `getSynonymBoost()`，但同义词能力尚未形成独立模块、单元测试和可量化准确率基线
- 在复杂业务系统中定位准确率约 **75%**
- 无法识别框架组件特性（AntD Select、Element DatePicker 等）

**代码证据：**
```typescript
// packages/extension/src/content/content.ts:1825
function scoreElements(params: Record<string, unknown>): Array<{
  element: HTMLElement;
  score: number;
  reasons: string[];
}> {
  // 问题：以文本匹配为主，缺少稳定的组件语义理解与验证闭环
  const queryLower = query.toLowerCase();
  const queryClean = queryLower.replace(/\s+/g, "");
  // ...
}
```

#### 痛点 3：缺少表单语义理解 🔍
**现状：**
- `fillForm()` 存在但功能有限（content.ts:2496）
- AI 无法一次性理解整个表单结构
- 每个字段都需要单独定位和填写

**缺失功能：**
- ❌ 没有 `get_form_structure` - AI 看不到完整表单模型
- ❌ 没有 `fill_form_smart` - 无法批量智能填写
- ❌ 没有组件框架识别（AntD、Element UI、Arco）

### 3. 已有优势 ✅

**做得好的地方：**
1. ✅ **QA 模块完整** - planner.ts、qa-tools.ts、reporter.ts、recorder.ts 已实现
2. ✅ **录制功能强大** - 支持 click、input、scroll、keydown 等事件录制
3. ✅ **报告生成完善** - HTML/Markdown 报告、Replay Viewer、CI Summary
4. ✅ **视觉兜底方案** - browser_visual_task 可处理复杂情况
5. ✅ **基础设施稳定** - WebSocket 通信、CDP 集成、权限控制

---

## 🎯 优化目标

### 核心指标改善
| 指标 | 现状 | 目标 | 改善幅度 |
|------|------|------|----------|
| **任务耗时 P50 / P95** | 阶段 0 基线 | P50 < 5s，P95 < 8s | 以基线校准 |
| **定位 Top-1 / Top-3 准确率** | 阶段 0 基线 | Top-1 > 90%，Top-3 > 97% | 以基线校准 |
| **MCP 往返次数** | 10+ 次 | 3-5 次 | **60% ↓** |
| **Token / 响应体积** | 阶段 0 基线 | -30% 至 -40% | 以基线校准 |
| **Fallback 成功率** | 阶段 0 基线 | smart 失败后 visual fallback > 90% | 新增指标 |

> **注**：以上目标基于代码分析估算，实际值需通过阶段 0 基线度量验证后校准。

---

## 🚀 执行计划（分阶段实施）

### 阶段 0：基线度量与基础设施（1-2 天）📐
> **在动手优化之前，先建立可量化的度量基线。**

#### 任务 0.1：建立性能 Benchmark 套件
**优先级：P0 - 所有后续优化的验证基础**

```
tests/
├── fixtures/
│   ├── native-form.html        # 原生 HTML 表单
│   ├── antd-form.html          # AntD 复杂表单
│   ├── element-form.html       # Element UI 表单
│   ├── large-page.html         # 1000+ 元素大页面
│   └── shadow-dom-page.html    # Shadow DOM 页面
├── replays/
│   ├── modal-form.json         # 弹窗表单录制回放
│   ├── iframe-form.json        # iframe 表单录制回放
│   └── table-filter.json       # 大表格筛选录制回放
├── benchmark/
│   ├── scoreElements.bench.ts  # 定位准确率 + 耗时
│   ├── getPageModel.bench.ts   # 页面模型获取耗时
│   ├── fillForm.bench.ts       # 填表端到端耗时
│   └── mcp-roundtrip.bench.ts  # MCP 往返次数统计
└── baseline.json               # 基线数据（自动生成）
```

**度量内容：**
| 度量项 | 方法 | 采样数 |
|--------|------|--------|
| `getPageModel()` 耗时 | 10 个不同页面各跑 5 次 | 50 |
| `scoreElements()` Top-1 / Top-3 准确率 | 50 个测试用例（已知正确元素） | 50 |
| 填表场景端到端耗时 P50 / P95 | 5 个典型业务流程，每个跑 5 次 | 25 |
| MCP 工具调用频次 | 记录一次完整测试流程的所有调用 | 5 |
| 响应体积 / Token 估算 | 采集 MCP 响应 JSON 字节数，必要时估算 tokens | 5 |
| Fallback 成功率 | 故意制造定位失败，验证 visual fallback | 10 |

**验收标准：**
- [ ] `pnpm bench` 可运行，输出结构化 JSON
- [ ] 基线数据保存到 `baseline.json`，后续优化可对比
- [ ] 测试 fixtures 覆盖原生、AntD、Element UI 三种表单
- [ ] 录制回放覆盖弹窗、iframe、大表格筛选三类真实复杂场景

#### 任务 0.2：引入 Vitest 测试框架
**优先级：P0**

```json
// 根 package.json
{
  "devDependencies": {
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "vitest-webextension-mock": "^0.1.0"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "bench": "vitest bench"
  }
}
```

> **注意**：Chrome Extension Content Script 需要特殊测试环境。使用 `vitest-webextension-mock` 模拟 `chrome.*` API，或用 `happy-dom` 替代 `jsdom` 获得更好的 Web Component 支持。

#### 任务 0.3：Feature Flag 系统
**优先级：P0 - 风险控制基础**

```typescript
// packages/shared/src/feature-flags.ts
export interface BrowserBridgeFeatureFlags {
  enableFormEngine: boolean;
  enableSmartFill: boolean;
  enableToolConsolidation: boolean;
  enableStructuredErrors: boolean;
  enableElementCache: boolean;
  enableFormCache: boolean;
  enableWebSocketHeartbeat: boolean;
}

export const DEFAULT_FEATURE_FLAGS: BrowserBridgeFeatureFlags = {
  enableFormEngine: false,
  enableSmartFill: false,
  enableToolConsolidation: false,
  enableStructuredErrors: false,
  enableElementCache: false,
  enableFormCache: false,
  enableWebSocketHeartbeat: false,
};
```

**运行时来源：**
- **MCP Server**：从 `process.env` 读取 `BB_ENABLE_XXX`，合并到 `DEFAULT_FEATURE_FLAGS`
- **Extension / Content Script**：不能直接依赖 Node `process.env`，通过 `chrome.storage.local`、构建时 define 或 MCP Server 握手下发配置读取
- **协议要求**：WebSocket 建连后 Server 下发当前 flags，Extension 缓存；用户刷新插件或重新连接后生效

**使用方式：**
```typescript
if (featureFlags.enableFormEngine) {
  // 新逻辑
} else {
  // 旧逻辑（回滚路径）
}
```

**默认策略：**
- 新能力默认关闭，完成阶段验收后再按场景灰度打开
- 性能缓存类 flag 必须先通过 benchmark，无回归后才能设为默认开启
- 工具合并类 flag 永远不默认移除旧工具，只控制新入口推荐和 warning 行为

---

### 第一阶段：快速提效（2-3 天）⚡

#### 任务 1.1：实现 Smart Form Engine
**优先级：P0 - 核心提速项**

**新增文件：**
```
packages/extension/src/content/form-engine.ts
```

**功能实现：**
```typescript
// 1. 智能表单结构提取
export interface FormStructure {
  forms: FormInfo[];
  fields: FieldInfo[];
  framework?: 'antd' | 'element-ui' | 'arco' | 'native';
}

export interface FieldInfo {
  id: string;
  label: string;
  type: 'input' | 'select' | 'date-range' | 'tree' | 'checkbox';
  framework: string;
  required: boolean;
  placeholder?: string;
  options?: string[];  // 下拉选项
  strategy: InteractionStrategy;  // 组件交互策略
  sensitive?: boolean;  // 是否敏感字段（密码、银行卡等）
}

// 2. 增强版框架识别器（多维度检测）
function detectFramework(): Framework {
  // 维度 1: CSS 类名前缀
  if (document.querySelector('[class*="ant-"]')) return 'antd';
  if (document.querySelector('[class*="el-"]')) return 'element-ui';
  if (document.querySelector('[class*="arco-"]')) return 'arco';

  // 维度 2: 全局变量检测（更可靠）
  if ((window as any).__ANTD_VERSION__ || (window as any).__umi?.antd) return 'antd';
  if ((window as any).__ELEMENT_UI__) return 'element-ui';

  // 维度 3: data-* 属性检测
  if (document.querySelector('[data-testid*="ant-"], [class*="ant-app"]')) return 'antd';
  if (document.querySelector('[data-v-]')) return 'element-ui'; // Vue scoped CSS

  // 维度 4: DOM 结构指纹（特定组件的标志性结构）
  if (document.querySelector('.ant-select-dropdown, .ant-picker-dropdown')) return 'antd';
  if (document.querySelector('.el-select-dropdown, .el-picker-panel')) return 'element-ui';

  return 'native';
}

// 3. Label-Control 映射
function mapLabelToControl(label: HTMLElement): HTMLElement | null {
  // 1. label[for] 显式关联
  // 2. .el-form-item, .ant-form-item 容器关联
  // 3. 空间距离关联（左侧或上方 50px 内）
  // 4. aria-label 补充
}
```

**敏感字段保护：**
```typescript
// 填写前检查敏感字段
function checkSensitiveField(field: FieldInfo): 'auto' | 'confirm' | 'block' {
  if (field.sensitive) {
    // 密码、银行卡等需要用户确认
    return 'confirm';
  }
  return 'auto';
}
```

**新增 MCP 工具：**
```typescript
// packages/mcp-server/src/tools/browser-tools.ts
export const getFormStructureTool = {
  name: "browser_get_form_structure",
  description: "提取当前页面的表单模型，返回所有字段的 Label、类型、选项、必填状态",
  inputSchema: {
    type: "object",
    properties: {
      tabId: { type: "number" }
    }
  }
};
```

**工具设计原则：**
- 优先复用 `browser_get_page_model` 的返回结构，在其 `includeForms: true` 参数下返回表单模型；只有返回体过大或调用语义明显独立时才新增 `browser_get_form_structure`
- 新工具必须附带 `summaryOnly` / `maxFields` 等限流参数，避免一次返回完整大表单导致响应膨胀
- 返回字段必须包含 `confidence`、`source`（label-for、form-item、aria、spatial 等）和 `warnings`，便于 AI 判断是否需要人工或视觉兜底

**预期效果：**
- AI 一次调用即可看到整个表单结构
- 减少 5-8 次 `browser_find` 调用
- **耗时从 15s → 8s**

---

#### 任务 1.2：实现批量智能填表
**优先级：P0**

**功能实现：**
```typescript
// packages/extension/src/content/form-engine.ts
export async function fillFormSmart(fields: FieldFillRequest[]): Promise<FillResult> {
  const results: FieldResult[] = [];
  
  for (const field of fields) {
    const element = findByLabel(field.label);
    const strategy = detectComponentStrategy(element);
    
    // 敏感字段保护
    if (checkSensitiveField(field) === 'confirm') {
      const confirmed = await showConfirmationOverlay({
        message: `即将填写敏感字段「${field.label}」，是否继续？`,
        timeout: 30_000
      });
      if (!confirmed) {
        results.push({ field: field.label, success: false, reason: 'user_cancelled' });
        continue;
      }
    }
    
    // 根据组件类型应用不同策略
    switch (strategy.type) {
      case 'antd-select':
        await fillAntdSelect(element, field.value);
        break;
      case 'element-date-range':
        await fillElementDateRange(element, field.value);
        break;
      case 'native-input':
        await fillNativeInput(element, field.value);
        break;
    }
    
    results.push({ field: field.label, success: true });
  }
  
  return { filled: results.length, failed: 0, results };
}

// 组件策略库
const COMPONENT_STRATEGIES = {
  'antd-select': {
    trigger: '.ant-select-selector',
    dropdown: '.ant-select-dropdown',
    option: '.ant-select-item-option',
    action: async (el, value) => {
      el.querySelector('.ant-select-selector').click();
      await waitFor('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
      const option = [...document.querySelectorAll('.ant-select-item-option')]
        .find(opt => opt.textContent?.includes(value));
      option?.click();
      await verifyValue(el, value);
    }
  },
  // ... 更多策略
};
```

**组件策略必须满足的契约：**
```typescript
interface ComponentStrategy {
  detect(element: HTMLElement): boolean;
  open(element: HTMLElement): Promise<void>;
  choose(element: HTMLElement, value: string): Promise<void>;
  verify(element: HTMLElement, expected: string): Promise<boolean>;
  rollback?(element: HTMLElement): Promise<void>;
}
```

**关键限制与降级：**
- AntD / Element UI 下拉可能使用 portal、虚拟列表、异步 option 和动画，不能只依赖 `textContent.includes(value)`
- 选择失败时先尝试输入搜索，再尝试键盘选择，最后降级到 `browser_visual_task`
- 每个字段填写后必须读取控件当前值或可访问名称验证；未验证成功不得返回 success
- 批量填写结果必须允许部分成功：返回 `filled`、`failed`、`results[]`，不要因为单字段失败丢失其它字段结果

**新增 MCP 工具：**
```typescript
export const fillFormSmartTool = {
  name: "browser_fill_form_smart",
  description: "批量填写表单字段，自动处理不同 UI 框架的组件差异（Select、DatePicker 等）",
  inputSchema: {
    type: "object",
    properties: {
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "字段标签，如'用户名'、'开始日期'" },
            value: { type: "string", description: "要填写的值" }
          }
        }
      }
    }
  }
};
```

**工具设计原则：**
- 优先作为 `browser_act({ action: "fillForm", fields })` 或 `browser_run_steps` 的批量 action 暴露；只有为了更清晰的模型发现才保留 `browser_fill_form_smart`
- `fields` 支持 `label`、`name`、`placeholder`、`selector`、`elementId` 多种定位输入，不能只支持 label
- 支持 `dryRun: true`，仅返回匹配字段、策略和风险，不实际填写

**预期效果：**
- 3 个字段填写从 8 次往返 → **1 次往返**
- **耗时从 8s → 3s**
- 自动处理组件交互（不需要 AI 知道要先点击下拉框）

---

#### 任务 1.3：优化 scoreElements 算法
**优先级：P1**

**改进点：**
```typescript
// packages/extension/src/content/content.ts
function scoreElements(params: Record<string, unknown>) {
  // 新增：组件感知评分
  if (element.matches('.ant-select, .el-select')) {
    score += 0.4; // 识别到框架组件，提高权重
    reasons.push("组件框架识别");
  }
  
  // 新增：表单上下文权重
  const formItem = element.closest('.form-item, .el-form-item, .ant-form-item');
  if (formItem) {
    const label = formItem.querySelector('label');
    if (label?.textContent?.includes(query)) {
      score += 0.6; // 强化表单上下文匹配
      reasons.push("表单项标签匹配");
    }
  }
  
  // 新增：模糊匹配增强（处理中文、拼音、同义词）
  const synonyms = getSynonyms(query); // "查询" → ["搜索", "检索", "筛选"]
  for (const synonym of synonyms) {
    if (accName.includes(synonym)) {
      score += 0.45;
      reasons.push(`同义词匹配: ${synonym}`);
      break;
    }
  }
}
```

**同义词数据来源：**
```typescript
// packages/extension/src/content/synonyms.ts
// 当前 content.ts 已有内联 CHINESE_SYNONYMS；本任务优先抽离、补测试、补基线，不重复引入第二份词表
export const SYNONYM_MAP: Record<string, string[]> = {
  "查询": ["搜索", "检索", "筛选", "查找"],
  "保存": ["确认", "确定", "提交"],
  "取消": ["关闭", "放弃"],
  "删除": ["移除", "清除"],
  // ... 约 150 组
};
```

**补充要求：**
- 对同义词 boost 增加误命中测试，例如“保存”不应优先命中危险操作中的“确认删除”
- 评分输出保留 reasons，并在 benchmark 中统计同义词导致的 Top-1 变化
- 同义词 boost 不应覆盖 role、disabled、高风险文本等更强约束

**预期效果：**
- 定位准确率从 75% → **90%+**
- 减少因定位失败导致的重试

---

### 第二阶段：基础设施增强（3-5 天）🔧
> 将工具合并和结构化错误码提前，因为它们是后续所有阶段的开发基础。

#### 任务 2.1：结构化错误码替代字符串匹配
**优先级：P0 - 影响后续所有开发效率**

**问题：** `browser_smart_act` 通过 `error.message.includes("ELEMENT_NOT_FOUND")` 触发视觉降级，极其脆弱。

**解决方案：**
```typescript
// packages/shared/src/errors.ts
export enum BridgeErrorCode {
  ELEMENT_NOT_FOUND = "ELEMENT_NOT_FOUND",
  AMBIGUOUS_TARGET = "AMBIGUOUS_TARGET",
  ELEMENT_NOT_INTERACTABLE = "ELEMENT_NOT_INTERACTABLE",
  TIMEOUT = "TIMEOUT",
  CONNECTION_LOST = "CONNECTION_LOST",
  NAVIGATION_FAILED = "NAVIGATION_FAILED",
  SENSITIVE_FIELD = "SENSITIVE_FIELD",
}

export class BridgeError extends Error {
  constructor(
    public code: BridgeErrorCode,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "BridgeError";
  }
}
```

**跨进程序列化格式：**
> Extension Content Script、Background、MCP Server 之间不能依赖 `error instanceof BridgeError`，错误必须以协议对象传输。

```typescript
export interface BridgeErrorPayload {
  ok: false;
  error: {
    code: BridgeErrorCode;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
    fallback?: "none" | "semantic" | "visual";
  };
}

// 使用
try {
  return await bridge.call("browser_click", params);
} catch (error) {
  const bridgeError = normalizeBridgeError(error);
  if (bridgeError.code === BridgeErrorCode.ELEMENT_NOT_FOUND) {
    return await visualFallback(params);
  }
  throw error;
}
```

**落地要求：**
- `throw new Error("ELEMENT_NOT_FOUND: ...")` 先保留兼容，但边界层统一转成 `BridgeErrorPayload`
- 新代码不再通过 `message.includes()` 判断错误类型
- MCP 响应中的错误保留人类可读 message，同时提供 machine-readable code
- `retryable` 只标记连接丢失、超时、内容脚本未就绪等瞬时问题，业务定位失败不默认重试

---

#### 任务 2.2：合并重复工具（67 → 分阶段收敛）
**优先级：P0 - 减少 LLM 决策复杂度**

**当前事实：** `packages/mcp-server/src/tools/browser-tools.ts` 中 `browser_*` 工具约 67 个。最终数量目标必须基于阶段 0 的工具调用统计与 README/skill 脚本依赖情况校准，不直接一次性删除到 35 个。

**当前重复工具清单：**

| 功能 | 重复工具 | 保留 | 废弃 |
|------|----------|------|------|
| 点击 | `browser_click`, `browser_find_and_click`, `browser_act`, `browser_smart_act` | `browser_act`（带 visual fallback 参数） | 其余 3 个 |
| 输入 | `browser_type`, `browser_find_and_type`, `browser_act` | `browser_act` | 其余 2 个 |
| 滚动 | `browser_scroll`, `browser_screen_scroll` | `browser_screen_scroll`（CDP 更通用） | `browser_scroll` |
| 按键 | `browser_press_key`, `browser_screen_press` | `browser_screen_press` | `browser_press_key` |
| 截图 | `browser_screenshot`, `browser_save_screenshot` | `browser_screenshot`（加 `save` 参数） | `browser_save_screenshot` |
| PDF | `browser_pdf`, `browser_save_pdf` | `browser_pdf`（加 `save` 参数） | `browser_save_pdf` |
| 页面观察 | `browser_observe`, `browser_get_ax_tree`, `browser_get_page_model`, `browser_get_page_snapshot`, `browser_get_page_text` | `browser_get_page_model`（核心）+ `browser_observe`（轻量） | `browser_get_page_snapshot`, `browser_get_ax_tree` |
| 网络模拟 | `browser_mock_network`, `browser_route` | `browser_route` | `browser_mock_network` |
| 选择 | `browser_select_option`, `browser_visual_select` | `browser_act`（action: "select"） | 其余 |

**工具治理原则：**
- 新能力优先作为现有工具的 action / 参数暴露，避免一边合并一边继续新增大量工具
- P0 先治理“推荐入口”和描述排序，不立即删除旧工具
- `browser_smart_act` 暂不废弃；它承载 visual grounding 闭环，应先合并到 `browser_act` 的 `fallback: "visual"` 能力后再考虑降级
- 删除工具前必须检查 README、skills、smoke tests、用户脚本和 MCP schema 快照

**废弃迁移策略：**
```typescript
// 1. 废弃工具添加 deprecation 标记，保留别名 2 个版本（minor 版本）
export const browser_click = {
  name: "browser_click",
  description: "[DEPRECATED since v0.4.0] Use browser_act with action='click' instead. Will be removed in v0.6.0.",
  handler: async (params) => {
    console.warn("[BrowserBridge] browser_click is deprecated. Use browser_act({ action: 'click', ...params })");
    return browser_act.handler({ ...params, action: "click" });
  }
};

// 2. 在 CHANGELOG.md 记录废弃计划
// 3. 在 README.md 工具一览中标记废弃工具
// 4. 首次使用废弃工具时返回 warning 到 MCP 响应
```

**分阶段目标：**
- v0.4：保留全部旧工具，新增推荐入口与 deprecation warning；工具描述 token 减少 15%+
- v0.5：旧工具转 thin alias，README / skills 全部迁移；默认工具列表可隐藏 deprecated 项
- v0.6：按使用数据删除低频 deprecated 工具；目标工具数再评估为 35-45

**预期效果：** LLM 选择工具的 token 消耗降低 **15-25%**，决策准确率提升

---

#### 任务 2.3：WebSocket 心跳与重连优化
**优先级：P0 - 连接可靠性是所有功能的基础**

**问题：**
- 无心跳机制，半开 TCP 连接无法检测
- 固定 1.5s 重连间隔，无指数退避
- 断连时无请求队列

**解决方案：**
```typescript
// 1. 应用层心跳
class HeartbeatManager {
  private interval = 10_000; // 10s
  private timeout = 5_000;   // 5s 等待 pong

  start(socket: WebSocket) {
    this.timer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      this.pongTimer = setTimeout(() => {
        console.warn("[Heartbeat] No pong, reconnecting...");
        socket.close();
      }, this.timeout);
    }, this.interval);
  }
}

// 2. 指数退避重连
function scheduleReconnect(attempt: number) {
  const delay = Math.min(1000 * Math.pow(2, attempt), 30_000); // 1s, 2s, 4s... max 30s
  const jitter = delay * 0.1 * Math.random();
  setTimeout(connect, delay + jitter);
}

// 3. 断连请求队列
class RequestQueue {
  private queue: Array<{ resolve: Function; reject: Function; message: any }> = [];
  private maxSize = 100;

  enqueue(message: any): Promise<any> {
    if (this.queue.length >= this.maxSize) {
      return Promise.reject(new Error("Queue full"));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, message });
    });
  }

  flush(socket: WebSocket) {
    const pending = this.queue.splice(0);
    pending.forEach(({ resolve, message }) => {
      socket.send(JSON.stringify(message));
      // 重新注册 pending 响应
    });
  }
}
```

**预期效果：** 连接可靠性提升，断连恢复时间从 **无限等待 → 自动恢复**

---

#### 任务 2.4：超时配置中心化
**优先级：P1**

**问题：** 20+ 处硬编码超时值，无法统一调整。

**解决方案：**
```typescript
// packages/shared/src/config.ts
export const TIMEOUTS = {
  // 连接
  CONNECTION_WAIT: 15_000,
  MAX_RECONNECT_WAIT: 25_000,
  DAEMON_START_DEADLINE: 10_000,
  HEALTH_CHECK: 2_000,

  // 页面操作
  PAGE_LOAD_READY: 15_000,
  PAGE_LOAD_COMMIT: 5_000,
  ELEMENT_WAIT: 4_000,
  WAIT_FOR: 30_000,

  // 工具特定
  SELECT_OPTION: 60_000,
  VISUAL_TASK: 60_000,
  RUN_STEP_PER_STEP: 8_000,
  CONSOLE_MONITOR: 5_000,

  // MCP Server
  DEFAULT_TOOL_TIMEOUT: 10_000,
  DAEMON_HTTP_OVERHEAD: 5_000,
} as const;

// 环境变量覆盖
export function getTimeout(key: keyof typeof TIMEOUTS): number {
  const envKey = `BB_TIMEOUT_${key}`;
  const envVal = process.env[envKey];
  return envVal ? parseInt(envVal, 10) : TIMEOUTS[key];
}
```

---

#### 任务 2.5：指数退避重试机制
**优先级：P1**

**问题：** 整个代码库零重试逻辑，瞬时失败直接报错。

**解决方案：**
```typescript
// packages/mcp-server/src/utils/retry.ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    retryOn?: (error: any) => boolean;
  } = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 500, maxDelay = 10000, retryOn } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts || (retryOn && !retryOn(error))) throw error;
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      const jitter = delay * 0.1 * Math.random();
      await new Promise(r => setTimeout(r, delay + jitter));
    }
  }
  throw new Error("Unreachable");
}

// 应用到关键路径
const result = await withRetry(() => bridge.call("browser_click", params), {
  retryOn: (err) => err.code === "TIMEOUT" || err.code === "CONNECTION_LOST"
});
```

**应用位置：**
- `DaemonBridgeClient.call()` — HTTP 瞬时失败
- `BrowserBridge.call()` — WebSocket 超时
- `capturePage()` — 截图/PDF 格式降级

---

#### 任务 2.6：响应体压缩
**优先级：P1**

**问题：**
- 所有响应使用 `JSON.stringify(result, null, 2)` 美化输出，膨胀 30-50%
- `browser_run_steps` 返回完整步骤数据，无摘要选项
- PDF 响应中 base64 数据出现两次

**解决方案：**
```typescript
// 1. 紧凑 JSON（非人类可读响应）
const formatted = JSON.stringify(result); // 去掉 null, 2

// 2. run_steps 摘要模式
export const runStepsSchema = {
  // ...existing...
  summaryOnly: { type: "boolean", description: "只返回摘要，不返回每步详情" }
};

// 3. PDF 响应去重
function formatPdfResult(result: any) {
  if (returnFormat === "resource") {
    return {
      content: [
        { type: "text", text: `PDF saved: ${result.path}` },
        // 不再重复 base64 到 text 字段
        { type: "resource", resource: { uri: result.path, blob: result.data } }
      ]
    };
  }
}
```

**预期效果：** 响应体积减少 **30-50%**，MCP 传输速度提升

---

#### 任务 2.7：runStepSchema 消除重复
**优先级：P2**

**问题：** `runStepSchema`（76 行）重复了所有独立工具的 schema 定义。

**解决方案：** 使用组合 schema
```typescript
const runStepSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["open", "click", "type", "scroll", ...] },
    // 通用目标字段
    ...targetProperties,
    // 按 action 条件包含的字段（使用 oneOf）
  },
  // 使用 allOf + if/then 实现条件 schema
  allOf: [
    { if: { properties: { action: { const: "type" } } }, then: { properties: { text: { type: "string" } } } },
    { if: { properties: { action: { const: "open" } } }, then: { properties: { url: { type: "string" } } } },
    // ...
  ]
};
```

---

### 第三阶段：语义化增强（3-5 天）🧠

#### 任务 3.1：实现 navigate_and_observe
**优先级：P1**

**功能：** 打开页面并立即返回业务摘要，减少初次加载的往返次数。

```typescript
export const navigateAndObserveTool = {
  name: "browser_navigate_and_observe",
  description: "打开 URL 并立即返回页面业务摘要（表单/按钮/列表），2 步合 1",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      waitForSelector: { type: "string" }
    },
    required: ["url"]
  }
};

// 实现
async function navigateAndObserve(params: any) {
  await openUrl(params.url);
  await waitForPageLoad();
  
  // 立即采集页面信息
  const [formStructure, interactives, pageModel] = await Promise.all([
    getFormStructure(),
    getInteractives({ limit: 30 }),
    getPageModel({ maxElements: 50 })
  ]);
  
  return {
    url: location.href,
    title: document.title,
    forms: formStructure.forms,
    buttons: interactives.filter(el => el.role === 'button'),
    summary: pageModel.summary
  };
}
```

**预期效果：**
- 从 `open_url` + `get_page_model` (2 次往返) → **1 次往返**

---

#### 任务 3.2：实现 click_semantic_btn
**优先级：P1**

**功能：** 根据语义直接点击按钮，自动处理遮挡和滚动。

```typescript
export const clickSemanticBtnTool = {
  name: "browser_click_semantic_btn",
  description: "根据语义（如'查询'、'保存'、'提交'）直接点击按钮，自动处理遮挡和同义词",
  inputSchema: {
    type: "object",
    properties: {
      semantic: { type: "string", description: "按钮语义，如'查询'、'确认'、'取消'" },
      context: { type: "string", description: "上下文区域，如'表单底部'、'弹窗'" }
    },
    required: ["semantic"]
  }
};

async function clickSemanticBtn(params: any) {
  const { semantic, context } = params;
  const synonyms = getSynonyms(semantic); // "查询" → ["搜索", "检索", "筛选", "查找"]
  
  let candidates = scoreElements({ 
    query: semantic,
    role: 'button',
    visibleOnly: true 
  });
  
  // 同义词扩展
  for (const syn of synonyms) {
    candidates.push(...scoreElements({ query: syn, role: 'button' }));
  }
  
  // 上下文过滤
  if (context) {
    candidates = candidates.filter(c => isInContext(c.element, context));
  }
  
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  
  // 自动处理遮挡
  if (isObstructed(best.element)) {
    await scrollIntoViewAndWait(best.element);
  }
  
  return await clickElement({ elementId: best.element.dataset.browseBridgeId });
}
```

---

#### 任务 3.3：实现策略缓存系统
**优先级：P2**

**功能：** 学习并缓存自定义组件的交互策略。

> **注意**：`match()` 逻辑运行在 Extension 端（有 DOM），缓存存储在 MCP Server 端（有文件系统）。两者通过 WebSocket 同步。

```typescript
// packages/shared/src/types.ts — 共享的策略描述（可序列化）
export interface ComponentStrategy {
  framework: string;
  componentType: string;
  selectors: {
    trigger: string;
    dropdown: string;
    option: string;
  };
  steps: Array<{ action: string; selector?: string; text?: string; key?: string }>; // 可序列化步骤，不存任意 JS
  domFingerprint?: string; // DOM 结构指纹，用于快速匹配
}

// packages/mcp-server/src/strategy-cache.ts — 缓存存储
export class StrategyCache {
  private cachePath = join(homedir(), '.browser-bridge', 'strategies.json');
  
  async save(strategy: ComponentStrategy) {
    const cache = await this.load();
    cache[`${strategy.framework}-${strategy.componentType}`] = strategy;
    await writeFile(this.cachePath, JSON.stringify(cache, null, 2));
  }
  
  async getAll(): Promise<Record<string, ComponentStrategy>> {
    return this.load();
  }
}

// packages/extension/src/content/component-matcher.ts — DOM 匹配（Extension 端）
export function matchStrategy(
  element: HTMLElement, 
  strategies: Record<string, ComponentStrategy>
): ComponentStrategy | null {
  for (const strategy of Object.values(strategies)) {
    // 通过 className、DOM 结构、data-* 属性匹配
    if (element.matches(strategy.selectors.trigger)) return strategy;
    if (strategy.domFingerprint && matchFingerprint(element, strategy.domFingerprint)) return strategy;
  }
  return null;
}
```

**安全约束：**
- 策略缓存不得存储或执行任意 `actionScript` 字符串，避免把本地文件缓存变成脚本执行入口
- 缓存内容只允许声明式步骤、选择器、框架版本、DOM 指纹和更新时间
- 命中缓存后仍需执行 `verify()`，失败则自动禁用该策略并回退到内置策略或视觉模式

---

### 第四阶段：DOM 性能深度优化（2-3 天）⚡

> 基于 content.ts 代码深度分析发现的性能瓶颈

#### 任务 4.1：getActionableElements() 请求级缓存
**优先级：P0 - 影响面最大的单项优化**

**问题：** `getActionableElements()` 每次执行完整的 Shadow DOM 遍历，在一次请求中被调用 **7+ 次**：
- `getVisualTargets()` → `getActionableElements()`
- `getPageSnapshot()` → `getActionableElements()`
- `getInteractives()` → `getActionableElements()`
- `getPageModel()` 内部 4+ 次子调用
- `scoreElements()` → `getActionableElements()`
- `focusNextElement()` → `getActionableElements()`

**解决方案：** 引入请求级元素缓存（带 debounce）
```typescript
// packages/extension/src/content/element-cache.ts
class RequestScopedElementCache {
  private elements: HTMLElement[] | null = null;
  private timestamp = 0;
  private readonly TTL = 500; // 500ms TTL
  private invalidateTimer: ReturnType<typeof setTimeout> | null = null;

  get(): HTMLElement[] {
    if (!this.elements || Date.now() - this.timestamp > this.TTL) {
      this.elements = collectActionableElements();
      this.timestamp = Date.now();
    }
    return this.elements;
  }

  invalidate(): void {
    // debounce: 避免高频 MutationObserver 回调导致缓存永远失效
    if (this.invalidateTimer) return;
    this.invalidateTimer = setTimeout(() => {
      this.elements = null;
      this.invalidateTimer = null;
    }, 100); // 100ms debounce
  }
}

// 全局实例，通过 MutationObserver 自动失效
const elementCache = new RequestScopedElementCache();
const observer = new MutationObserver(() => elementCache.invalidate());
observer.observe(document.body, { childList: true, subtree: true });
```

**失效边界：**
- 每个 MCP 工具调用开始创建 request context，调用结束后清理请求级缓存
- click/type/scroll/hover/select/open/waitFor 等可能改变页面状态的操作完成后立即 invalidate
- `resize`、`scroll`、`visibilitychange`、MutationObserver 都触发失效；iframe / shadow DOM 无法完整感知时以短 TTL 和定期全量刷新兜底
- 缓存 flag 默认关闭，只有阶段 0 benchmark 证明无准确率回归后再灰度开启

**预期效果：** `getPageModel()` 耗时降低 **60-70%**

---

#### 任务 4.2：isVisible() 结果缓存
**优先级：P0**

**问题：** `isVisible()` 每次调用 `getComputedStyle()` + `getBoundingClientRect()`，强制浏览器重排。在一次 `getPageModel()` 中被调用数百次。

**解决方案：** WeakMap 缓存
```typescript
const visibilityCache = new WeakMap<HTMLElement, { visible: boolean; time: number }>();

function isVisible(element: HTMLElement): boolean {
  const cached = visibilityCache.get(element);
  if (cached && Date.now() - cached.time < 300) {
    return cached.visible;
  }
  const visible = checkVisible(element); // 原始逻辑
  visibilityCache.set(element, { visible, time: Date.now() });
  return visible;
}
```

**预期效果：** 减少 80%+ 的 `getComputedStyle()` 调用

**正确性要求：**
- 缓存 key 必须绑定 request context；不要用长期全局可见性缓存
- 动画、滚动、弹窗出现后可见性变化频繁，写操作后必须清空 WeakMap
- benchmark 同时统计性能和定位准确率，准确率下降时不得合入

---

#### 任务 4.3：findControlByLabel() 查询优化
**优先级：P1**

**问题：** `document.querySelectorAll("body *")` 遍历整个 DOM 树，然后逐个检查可见性。

```typescript
// 当前：O(n) 全量遍历 + 每元素 isVisible()
const candidates = Array.from(document.querySelectorAll<HTMLElement>("body *"));
```

**解决方案：** 缩小选择器范围 + 提前过滤
```typescript
// 优化：只查表单相关元素
const candidates = Array.from(document.querySelectorAll<HTMLElement>(
  "input, select, textarea, button, [role='textbox'], [role='combobox'], [role='listbox'], [contenteditable]"
));
// 先过滤有文本的元素，再检查可见性
const withText = candidates.filter(el => el.textContent?.trim() || el.getAttribute('aria-label'));
const visible = withText.filter(isVisible);
```

**预期效果：** 大型页面（1000+ 元素）查询速度提升 **5-10x**

---

#### 任务 4.4：scoreElements() 延迟计算
**优先级：P1**

**问题：** `getNearbyText(element)` 对每个元素遍历 6 个父/兄弟节点，数百元素产生数千次 DOM 查询。

**解决方案：** 先粗筛再精算
```typescript
function scoreElements(params: Record<string, unknown>) {
  const elements = getActionableElements();

  // 第一轮：快速粗筛（只用直接文本匹配）
  const candidates = elements
    .map(el => ({ element: el, quickScore: quickTextMatch(el, query) }))
    .filter(c => c.quickScore > 0.2);

  // 第二轮：精算（只对候选者计算 nearbyText、组件识别等）
  return candidates.map(c => ({
    element: c.element,
    score: deepScore(c.element, query, c.quickScore),
    reasons: getReasons(c.element, query)
  })).sort((a, b) => b.score - a.score);
}
```

**预期效果：** `scoreElements()` 耗时降低 **50-60%**

---

#### 任务 4.5：getVisibleText() 改用 TreeWalker
**优先级：P2**

**问题：** 递归 `walk()` 函数访问每个文本节点，每个元素节点都调用 `isVisible()`。

**解决方案：**
```typescript
function getVisibleText(): string {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        return isVisible(parent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    }
  );
  const parts: string[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent?.trim();
    if (text) parts.push(text);
  }
  return parts.join(" ");
}
```

---

#### 任务 4.6：findInDeepScope() Shadow DOM 注册表
**优先级：P2**

**问题：** 每次 `querySelector` 都递归遍历所有 Shadow DOM，最坏 O(n²)。

**解决方案：** 维护 Shadow Root 注册表
```typescript
const shadowRootRegistry = new WeakSet<Node>();

// 在 getActionableElements() 遍历时注册所有 shadowRoot
function registerShadowRoots(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let el: Element | null;
  while ((el = walker.nextNode() as Element | null)) {
    if (el.shadowRoot) {
      shadowRootRegistry.add(el.shadowRoot);
      registerShadowRoots(el.shadowRoot); // 递归注册嵌套 shadow
    }
  }
}

// 查询时直接遍历注册表
function queryInDeepScope(selector: string): Element[] {
  const results = [...document.querySelectorAll(selector)];
  // 遍历已注册的 shadowRoot
  // (需要将 WeakSet 改为可遍历的结构，如 WeakRef 数组)
  return results;
}
```

---

#### 任务 4.7：Recording 事件监听器动态挂载
**优先级：P2**

**问题：** 6 个事件监听器（click、change、input、keydown、submit、scroll）永久注册，每次用户交互都触发 `if (!isRecording) return` 分支检查。

**解决方案：**
```typescript
function setRecordingState(recording: boolean) {
  if (recording && !listenersAttached) {
    document.addEventListener("click", handleClick, { capture: true });
    document.addEventListener("change", handleChange, { capture: true });
    // ... 其他监听器
    listenersAttached = true;
    urlPollTimer = setInterval(checkUrlChange, 500);
  } else if (!recording && listenersAttached) {
    document.removeEventListener("click", handleClick, { capture: true });
    // ... 移除其他监听器
    listenersAttached = false;
    clearInterval(urlPollTimer);
  }
}
```

---

### 第五阶段：页面观察结果缓存与变量优化（1-2 天）⚡

#### 任务 5.1：页面观察结果缓存
**优先级：P2**

**问题：** `browser_get_page_model`、`browser_observe`、`browser_list_tabs` 每次都从浏览器获取全新数据。

**解决方案：** 短 TTL 缓存，写操作自动失效
```typescript
class ObservationCache {
  private cache = new Map<string, { data: any; time: number }>();
  private readonly TTL = 2000; // 2 秒

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.time < this.TTL) return entry.data;
    return null;
  }

  set(key: string, data: any) {
    this.cache.set(key, { data, time: Date.now() });
  }

  // 任何写操作（click/type/scroll）后清除
  invalidate() {
    this.cache.clear();
  }
}
```

**预期效果：** 快速连续观察调用从 **2 次往返 → 0 次往返**

---

#### 任务 5.2：批量变量操作
**优先级：P2**

**问题：** `browser_run_skill` 循环调用 `bridge.setVariable()`，每次 HTTP 往返。

**解决方案：**
```typescript
// 新增批量端点
export const setVariablesTool = {
  name: "browser_set_variables",
  description: "批量设置多个变量（一次往返）",
  inputSchema: {
    type: "object",
    properties: {
      variables: { type: "object", additionalProperties: {} }
    }
  }
};
```

---

### 第六阶段：容错与可靠性（2-3 天）🛡️

#### 任务 6.1：capturePage 错误日志
**优先级：P1**

**问题：** `capturePage()` 的 catch 块用 `void message` 吞掉错误，调试困难。

```typescript
// 修改前
catch (message) { void message; }

// 修改后
catch (error) {
  console.warn(`[capturePage] ${format} failed:`, error instanceof Error ? error.message : error);
}
```

---

#### 任务 6.2：showConfirmationOverlay() 超时保护
**优先级：P1**

**问题：** 确认弹窗无超时，用户不操作则 Promise 永不 resolve。

```typescript
function showConfirmationOverlay(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // ... 创建 overlay ...

    // 60 秒超时自动取消
    const timeout = setTimeout(() => {
      overlay.remove();
      resolve(false);
    }, 60_000);

    confirmBtn.onclick = () => { clearTimeout(timeout); overlay.remove(); resolve(true); };
    cancelBtn.onclick = () => { clearTimeout(timeout); overlay.remove(); resolve(false); };
  });
}
```

---

#### 任务 6.3：智能重试与降级机制
**优先级：P1**

```typescript
// 智能重试机制
async function fillFormWithFallback(fields: FieldFillRequest[]) {
  try {
    // 第一次：智能填写
    return await fillFormSmart(fields);
  } catch (error) {
    console.warn('[FallbackLayer1] Smart fill failed, trying semantic fill');
    
    try {
      // 第二次：语义降级（逐个字段用 browser_act）
      return await fillFormSemantic(fields);
    } catch (error2) {
      console.warn('[FallbackLayer2] Semantic fill failed, trying visual');
      
      // 第三次：视觉兜底
      return await fillFormVisual(fields);
    }
  }
}
```

---

### 第七阶段：工程化提升（3-5 天）📊

#### 任务 7.1：编写核心函数单元测试
**优先级：P0**

> **前置条件**：阶段 0 已完成 Vitest 引入和测试 fixtures 搭建。

**优先测试目标：**
1. `scoreElements()` — 复杂评分逻辑，最易出 bug
2. `cleanRecordedSteps()` — 步骤清洗逻辑
3. `sanitizeForLog()` — 安全相关
4. `security.ts` URL 匹配 — 安全边界
5. `isRecord()` / `isSensitive()` — 类型守卫

```typescript
// tests/unit/scoreElements.test.ts
describe("scoreElements", () => {
  it("should rank exact text match highest", () => {
    const results = scoreElements({ query: "用户名" });
    expect(results[0].element.textContent).toContain("用户名");
  });

  it("should match synonyms", () => {
    const results = scoreElements({ query: "查询" });
    expect(results.some(r => r.reasons.includes("同义词匹配: 搜索"))).toBe(true);
  });

  it("should boost form context matches", () => {
    const results = scoreElements({ query: "邮箱" });
    const formMatch = results.find(r => r.element.closest('.ant-form-item'));
    expect(formMatch?.score).toBeGreaterThan(0.8);
  });
});
```

---

#### 任务 7.2：消除重复代码
**优先级：P1**

**重复代码清单：**

| 函数 | 重复位置 | 处理方式 |
|------|----------|----------|
| `isRecord()` | 5 个文件 | 提取到 `shared/src/utils.ts` |
| `PROTOCOL_VERSION` | 2 个文件 | 统一从 shared 导入 |
| `HIGH_RISK_TEXT_PATTERNS` | 2 个文件（security.ts + content.ts） | 提取到 shared |
| `BRIDGE_PORT` 默认值 | 2 个文件 | 统一常量 |

```typescript
// packages/shared/src/utils.ts
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSensitive(field: { placeholder?: string; ariaLabel?: string; text?: string }): boolean {
  const patterns = [/password/i, /密码/i, /secret/i, /token/i, /验证码/];
  const text = [field.placeholder, field.ariaLabel, field.text].filter(Boolean).join(" ");
  return patterns.some(p => p.test(text));
}
```

---

#### 任务 7.3：TypeScript 类型安全增强
**优先级：P1**

**问题：** 大量 `any` 类型，`BrowserStep` 50+ 可选属性，形同无类型。

```typescript
// 1. BrowserStep 改为判别联合
type BrowserStep =
  | { action: "open"; url: string; waitUntil?: "load" | "domcontentloaded" | "networkidle" }
  | { action: "click" } & BrowserStepTarget
  | { action: "type"; text: string; delay?: number } & BrowserStepTarget
  | { action: "scroll"; direction: "up" | "down"; amount?: number }
  | { action: "screenshot"; fullPage?: boolean }
  | { action: "wait"; duration?: number; selector?: string }
  | { action: "press"; key: string }
  | { action: "hover" } & BrowserStepTarget
  | { action: "select"; value: string } & BrowserStepTarget;

// 2. 消除 any
interface BrowserToolBridge {
  setVariable(name: string, value: string | number | boolean): Promise<void>;
  getVariable(name: string): Promise<string | number | boolean | undefined>;
}

// 3. BridgeRequest 判别联合
type BridgeRequestMap = {
  browser_click: { selector?: string; text?: string; elementId?: string };
  browser_type: { selector?: string; text: string; elementId?: string };
  // ... 每个工具类型安全的参数
};
type BridgeRequest = { [K in BridgeTool]: { tool: K; params: BridgeRequestMap[K] } }[BridgeTool];
```

---

#### 任务 7.4：Vite 构建优化
**优先级：P2**

```typescript
// packages/extension/vite.config.ts
export default defineConfig({
  build: {
    target: 'chrome100',  // 现代 JS，减少 polyfill
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          'content': ['src/content/content.ts'],
          'background': ['src/background/background.ts'],
        }
      }
    }
  }
});
```

---

#### 任务 7.5：TypeScript 增量构建
**优先级：P2**

```json
// packages/shared/tsconfig.json
{
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}

// packages/mcp-server/tsconfig.json
{
  "references": [{ "path": "../shared" }],
  "compilerOptions": {
    "composite": true
  }
}
```

---

#### 任务 7.6：审计日志批量写入
**优先级：P2**

**问题：** 每次操作都 read-modify-write 整个审计日志数组。

```typescript
class AuditLogBuffer {
  private buffer: AuditEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_INTERVAL = 5000;
  private readonly MAX_BUFFER_SIZE = 10;

  append(entry: AuditEntry) {
    this.buffer.push(entry);
    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.FLUSH_INTERVAL);
    }
  }

  private async flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    const entries = this.buffer.splice(0);
    if (entries.length === 0) return;

    const existing = await chrome.storage.local.get("auditLog");
    const log = [...entries, ...(existing.auditLog || [])].slice(0, 100);
    await chrome.storage.local.set({ auditLog: log });
  }
}
```

---

#### 任务 7.7：storage.local 读取缓存
**优先级：P2**

**问题：** 每次 click/hover/type 都读 `chrome.storage.local`，异步开销大。

```typescript
const storageCache = new Map<string, { value: any; time: number }>();
const STORAGE_TTL = 5000;

async function getCachedStorage<T>(key: string): Promise<T> {
  const cached = storageCache.get(key);
  if (cached && Date.now() - cached.time < STORAGE_TTL) return cached.value;

  const result = await chrome.storage.local.get(key);
  storageCache.set(key, { value: result[key], time: Date.now() });
  return result[key];
}

// 监听变化自动失效
chrome.storage.onChanged.addListener((changes) => {
  for (const key of Object.keys(changes)) {
    storageCache.delete(key);
  }
});
```

---

#### 任务 7.8：修复 stringToBase64 O(n²) 问题
**优先级：P2**

```typescript
// 修改前：字符串拼接 O(n²)
for (let i = 0; i < len; i++) {
  binary += String.fromCharCode(bytes[i]);
}

// 修改后：数组 join O(n)
const binary = Array.from(bytes, b => String.fromCharCode(b)).join("");
```

---

#### 任务 7.9：publish-release.sh 修复
**优先级：P2**

```bash
# 修改前
ROOT="/Users/didi/Desktop/my-project/browser-bridge-1"

# 修改后
ROOT="$(cd "$(dirname "$0")" && pwd)"

# 版本号从 package.json 读取
SHARED_VERSION=$(node -p "require('./packages/shared/package.json').version")
EXTENSION_VERSION=$(node -p "require('./packages/extension/package.json').version")
MCP_VERSION=$(node -p "require('./packages/mcp-server/package.json').version")
```

---

### 第八阶段：QA 模块增强（3-5 天）🔄

> 基于 QA 模块深度分析

#### 任务 8.1：测试用例并行执行
**优先级：P1**

**问题：** `browser_qa_run` 顺序执行所有用例，独立用例无法并行。

**资源约束：** 每个并行用例需要一个独立 Tab，Chrome 内存开销约 50-100MB/tab。建议最大并行数 = `min(用例数, 5)`。

```typescript
async function runQa(params: QaRunParams): Promise<QaRunResult> {
  // 1. 分析依赖关系
  const { independent, dependent } = analyzeDependencies(params.cases);

  // 2. 并行执行独立用例（每个用例一个 tab，最多 5 个并行）
  const MAX_PARALLEL = 5;
  const independentResults = await parallelLimit(
    independent.map(c => () => runQaCaseInNewTab(c)),
    MAX_PARALLEL
  );

  // 3. 按依赖顺序执行有依赖的用例
  const dependentResults = [];
  for (const group of topologicalSort(dependent)) {
    const groupResults = await Promise.allSettled(
      group.map(c => runQaCase(c))
    );
    dependentResults.push(...groupResults);
  }

  return mergeResults(independentResults, dependentResults);
}

// 并行限制工具函数
async function parallelLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = [];
  const executing = new Set<Promise<void>>();
  
  for (const task of tasks) {
    const p = task().then(r => { results.push(r); });
    const wrapped = p.then(() => { executing.delete(wrapped); });
    executing.add(wrapped);
    if (executing.size >= limit) await Promise.race(executing);
  }
  
  await Promise.all(executing);
  return results;
}
```

---

#### 任务 8.2：BrowserAgentPlanner LLM 集成
**优先级：P1**

**问题：** `BrowserAgentPlanner.nextStep()` 只有两个硬编码分支，无实际规划能力。

**架构设计：**
```
用户请求 → Claude Code (已有 LLM)
                ↓
         browser_qa_run (MCP 工具)
                ↓
         BrowserAgentPlanner
                ↓
         需要额外 LLM 调用？❌ 不需要！
```

**关键洞察**：BrowserAgentPlanner 不应自己调用 LLM。当前架构中，**Claude Code 本身就是 LLM**，Planner 应该是一个**确定性的状态机**，由 Claude Code 通过 MCP 工具驱动。

```typescript
// 正确架构：Planner 是确定性状态机，不做 LLM 调用
class BrowserAgentPlanner {
  private state: PlannerState = 'idle';
  private history: PlannerStep[] = [];

  // 返回下一步建议，由 Claude Code 决定是否执行
  nextStep(observation: PageModel, goal: string): PlannerDecision {
    const state = this.analyzeState(observation, goal);
    
    switch (state) {
      case 'need_navigate':
        return { action: 'navigate', url: this.extractTargetUrl(goal) };
      case 'need_fill_form':
        return { action: 'fill_form', fields: this.extractFields(observation) };
      case 'need_submit':
        return { action: 'click', target: this.findSubmitButton(observation) };
      case 'goal_achieved':
        return { action: 'done', summary: this.summarizeResult(observation) };
      case 'stuck':
        return { action: 'fallback', reason: '无法确定下一步，请使用视觉模式' };
    }
  }

  private analyzeState(observation: PageModel, goal: string): PlannerState {
    // 基于页面模型和目标的确定性分析
    // 不调用 LLM，使用规则引擎
  }
}
```

**如果未来确实需要 Planner 调用 LLM**（例如处理完全开放式的任务），则：
- 通过环境变量 `BB_PLANNER_LLM_ENDPOINT` 配置
- 支持 OpenAI-compatible API（可接本地模型）
- 设置延迟预算：单次 `nextStep()` 最多 3 秒
- Token 预算：单次调用最多 500 tokens

---

#### 任务 8.3：QA 结果摘要模式
**优先级：P1**

**问题：** `browser_qa_run` 返回完整 `runResult`（含每步截图），响应可能数 MB。

```typescript
export const qaRunSchema = {
  // ...existing...
  summaryOnly: { type: "boolean", description: "只返回摘要，不返回详细步骤" }
};

// 响应格式化
function formatQaResult(result: QaRunResult, summaryOnly: boolean) {
  if (summaryOnly) {
    return {
      total: result.cases.length,
      passed: result.cases.filter(c => c.status === "passed").length,
      failed: result.cases.filter(c => c.status === "failed").length,
      blocked: result.cases.filter(c => c.status === "blocked").length,
      duration: result.totalDurationMs,
      // 只返回失败用例的详情
      failures: result.cases
        .filter(c => c.status === "failed")
        .map(c => ({ name: c.name, error: c.error }))
    };
  }
  return result;
}
```

---

#### 任务 8.4：录制器敏感数据增强
**优先级：P2**

```typescript
function isSensitive(step: RecordedStep): boolean {
  const patterns = [/password/i, /密码/i, /secret/i, /token/i, /验证码/, /credit.?card/i, /身份证/];

  // 检查 placeholder、ariaLabel、text
  const fieldText = [step.placeholder, step.ariaLabel, step.text].filter(Boolean).join(" ");
  if (patterns.some(p => p.test(fieldText))) return true;

  // 新增：检查 input type
  if (step.elementType === "password") return true;

  // 新增：检查 value 内容（如果看起来像敏感数据）
  if (step.value && /[\d]{16,19}/.test(step.value)) return true; // 信用卡号
  if (step.value && /[\d]{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/.test(step.value)) return true; // 身份证

  return false;
}
```

---

#### 任务 8.5：录制步骤清理逻辑修复
**优先级：P2**

**问题：** `cleanRecordedSteps` 丢弃所有无语义属性的 click，可能误删 canvas/custom 组件点击。

```typescript
function cleanRecordedSteps(steps: RecordedStep[]): RecordedStep[] {
  return steps.filter(step => {
    if (step.action !== "click") return true;

    // 有语义属性，保留
    if (step.text || step.selector || step.ariaLabel || step.placeholder || step.testId) {
      return true;
    }

    // 新增：有坐标信息的保留（可能是 canvas 点击）
    if (step.coordinates) return true;

    // 新增：有 data-* 属性的保留
    if (step.element && Object.keys(step.element).some(k => k.startsWith("data-"))) {
      return true;
    }

    return false;
  });
}
```

---

## 📁 文件结构规划

```
packages/
├── extension/src/
│   ├── content/
│   │   ├── content.ts (优化 scoreElements, isVisible, getVisibleText)
│   │   ├── form-engine.ts (新增) ⭐
│   │   ├── form-cache.ts (新增)
│   │   ├── element-cache.ts (新增) ⭐ — 请求级元素缓存
│   │   ├── component-strategies.ts (新增)
│   │   ├── component-matcher.ts (新增) — DOM 匹配逻辑
│   │   └── synonyms.ts (新增)
│   │
│   ├── background/
│   │   ├── background.ts (优化 broadcast、audit log)
│   │   └── security.ts (提取共享 patterns)
│   │
│   └── shared/
│       └── config.ts (统一版本号，从 shared 包导入)
│
├── mcp-server/src/
│   ├── tools/
│   │   ├── browser-tools.ts (治理重复工具，从约 67 个分阶段收敛)
│   │   └── form-tools.ts (可选新增；优先复用 browser_act / browser_get_page_model) ⭐
│   ├── bridge/
│   │   ├── browser-bridge.ts (心跳、重连、请求队列)
│   │   └── daemon-client.ts (重试、连接池)
│   ├── utils/
│   │   ├── retry.ts (新增) — 指数退避重试
│   │   └── cache.ts (新增) — 观察结果缓存
│   ├── strategy-cache.ts (新增)
│   └── qa/
│       ├── planner.ts (确定性状态机，非 LLM 调用)
│       ├── qa-tools.ts (并行执行、摘要模式)
│       ├── reporter.ts (流式报告)
│       └── recorder.ts (敏感数据增强)
│
├── shared/src/
│   ├── types.ts (BrowserStep 判别联合，消除 any)
│   ├── errors.ts (新增) — BridgeError + BridgeErrorCode
│   ├── feature-flags.ts (新增) — Feature Flag 系统
│   ├── utils.ts (新增) — isRecord, isSensitive 等共享工具
│   ├── config.ts (新增) — TIMEOUTS 常量
│   └── protocol.ts (统一 PROTOCOL_VERSION)
│
└── tests/ (新增) ⭐
    ├── fixtures/
    │   ├── native-form.html
    │   ├── antd-form.html
    │   ├── element-form.html
    │   ├── large-page.html
    │   └── shadow-dom-page.html
    ├── benchmark/
    │   ├── scoreElements.bench.ts
    │   ├── getPageModel.bench.ts
    │   └── fillForm.bench.ts
    ├── unit/
    │   ├── scoreElements.test.ts
    │   ├── cleanRecordedSteps.test.ts
    │   ├── sanitizeForLog.test.ts
    │   ├── security.test.ts
    │   └── isRecord.test.ts
    └── integration/
        └── smoke-test.mjs (增强：添加断言)
```

---

## ✅ 验收标准

### 阶段 0 验收（1-2 天后）
- [ ] `pnpm bench` 可运行，输出结构化 JSON 到 `baseline.json`
- [ ] `pnpm test` 可用，Vitest 框架集成完成
- [ ] Feature Flag 系统生效：MCP Server 支持环境变量，Extension 支持 storage / 握手下发配置
- [ ] 测试 fixtures 覆盖原生、AntD、Element UI 三种表单
- [ ] 录制回放覆盖弹窗、iframe、大表格筛选三类复杂场景
- [ ] 基线包含 P50/P95 耗时、Top-1/Top-3 准确率、响应体积、往返次数和 fallback 成功率

### 阶段一验收（2-3 天后）
- [ ] `browser_get_page_model({ includeForms: true })` 或 `browser_get_form_structure` 可以返回完整表单模型
- [ ] `browser_act({ action: "fillForm" })` 或 `browser_fill_form_smart` 可以一次性填写 3 个字段
- [ ] 支持识别 AntD Select、Element UI DatePicker
- [ ] 每个字段填写后有读回验证，失败字段可单独报告，不影响已成功字段
- [ ] 3 字段填表任务 P50 < 5s，P95 < 8s（基于阶段 0 基线对比）
- [ ] 元素定位 Top-1 > 90%，Top-3 > 97%
- [ ] 敏感字段填写前有确认弹窗

### 阶段二验收（3-5 天后）
- [ ] 结构化错误码以可序列化 `BridgeErrorPayload` 替代新代码中的字符串匹配
- [ ] MCP 工具治理完成 v0.4 目标：推荐入口明确、deprecated warning 可控、描述 token 减少 15%+
- [ ] 废弃工具有明确的迁移提示和版本计划
- [ ] WebSocket 心跳检测死连接 < 15 秒
- [ ] 断连后自动重连，指数退避 max 30s
- [ ] 响应体积减少 30%+
- [ ] MCP Server 超时值可通过环境变量覆盖；Extension 超时值可通过 storage / 握手配置覆盖

### 阶段三验收（3-5 天后）
- [ ] `browser_navigate_and_observe` 减少初次加载往返
- [ ] `browser_click_semantic_btn` 支持同义词匹配
- [ ] 策略缓存系统可保存和复用自定义组件策略
- [ ] MCP 往返次数从 10+ 降至 3-5 次

### 阶段四验收（2-3 天后）
- [ ] `getPageModel()` 耗时降低 60%+（基于阶段 0 基线）
- [ ] `isVisible()` 调用次数减少 80%+
- [ ] 定位准确率无回归，缓存开启和关闭的 benchmark 对比可追溯
- [ ] 大型页面（1000+ 元素）`findControlByLabel()` < 200ms
- [ ] Recording 事件监听器按需挂载

### 阶段五验收（1-2 天后）
- [ ] 快速连续观察调用从 2 次往返 → 0 次往返
- [ ] 批量变量操作一次往返完成

### 阶段六验收（2-3 天后）
- [ ] 关键路径有重试机制（max 3 次，指数退避）
- [ ] `capturePage` 错误不再被静默吞掉
- [ ] `showConfirmationOverlay()` 有 60s 超时
- [ ] 三层降级机制：smart → semantic → visual

### 阶段七验收（3-5 天后）
- [ ] 核心函数（scoreElements、cleanRecordedSteps）有单元测试
- [ ] 重复代码（isRecord、PROTOCOL_VERSION）提取到 shared
- [ ] `any` 类型减少 80%+
- [ ] 增量构建启用（composite + references）

### 阶段八验收（3-5 天后）
- [ ] 独立测试用例可并行执行（最多 5 个 tab）
- [ ] QA 结果支持摘要模式
- [ ] 敏感数据检测覆盖 input type 和 value 内容
- [ ] BrowserAgentPlanner 为确定性状态机，无隐藏 LLM 调用

---

## 📊 预期收益

### 性能收益
- **任务耗时：目标 P50 < 5s，P95 < 8s**（以阶段 0 基线校准）
- **定位准确率：目标 Top-1 > 90%，Top-3 > 97%**
- **Token / 响应体积：目标减少 30-40%**

### 开发体验收益
- AI Agent 可以"看懂"整个表单
- 减少调试和重试次数
- 更稳定的自动化测试

### 业务价值
- 更快的测试反馈周期
- 更高的测试覆盖率
- 更低的维护成本

---

## 🚧 风险与应对

### 风险 1: 框架识别不准确
**应对：** 
- 多维度检测（CSS 类名 + 全局变量 + data-* 属性 + DOM 结构指纹）
- 提供手动指定框架的参数
- 降级到通用策略

### 风险 2: 自定义组件无法识别
**应对：**
- 视觉工具兜底 (browser_visual_task)
- 策略学习系统记录并复用

### 风险 3: 性能回归
**应对：**
- 阶段 0 建立的 Benchmark 套件，每次优化后跑基线对比
- Feature Flag 可快速回滚到旧逻辑
- 性能监控埋点
- 缓存类优化必须同时比较准确率；只提升耗时但降低定位准确率的改动不得合入

### 风险 4: 工具合并导致现有用户脚本失效
**应对：**
- 废弃工具保留 2 个 minor 版本的别名
- 首次使用废弃工具时在 MCP 响应中返回一次性 warning，避免每次污染 token
- CHANGELOG.md 记录完整迁移指南
- README、skills、smoke tests 和历史脚本完成迁移后再考虑删除旧工具

### 风险 5: MutationObserver 高频回调导致缓存失效
**应对：**
- 缓存 invalidate 加 100ms debounce
- 对 iframe/shadow DOM 内的变更不感知（已知限制，通过定期全量刷新兜底）

### 风险 6: Smart Fill 误填或未验证成功
**应对：**
- 支持 `dryRun`，先返回匹配字段、策略、置信度和风险
- 每个字段写入后必须读回验证；验证失败不得返回 success
- 敏感字段默认 confirm，高风险字段可 block
- 批量填写保留部分成功结果，失败字段进入 semantic / visual fallback

---

## 🔄 Feature Flag 与回滚机制

每个阶段的新功能都通过 Feature Flag 控制，出现问题时可快速回滚：

| Flag | 默认值 | 控制功能 |
|------|--------|----------|
| `BB_ENABLE_FORM_ENGINE` | `false` | Smart Form Engine |
| `BB_ENABLE_SMART_FILL` | `false` | 批量智能填表 |
| `BB_ENABLE_TOOL_CONSOLIDATION` | `false` | 工具合并（需手动开启） |
| `BB_ENABLE_STRUCTURED_ERRORS` | `false` | 结构化错误码（需手动开启） |
| `BB_ENABLE_ELEMENT_CACHE` | `false` | 元素缓存 |
| `BB_ENABLE_FORM_CACHE` | `false` | 表单缓存 |
| `BB_ENABLE_WEBSOCKET_HEARTBEAT` | `false` | WebSocket 心跳（需手动开启） |

**回滚步骤：**
1. 设置环境变量 `BB_ENABLE_XXX=false`
2. 重启 MCP Server
3. 如果功能涉及 Extension / Content Script，同步清理 `chrome.storage.local` 中的 flag 或通过握手下发关闭配置
4. 刷新目标页面；必要时重新加载插件
5. 确认旧逻辑自动生效，并跑对应 smoke / benchmark 子集

---

## 📋 E2E 验收方案

### 标准测试场景

| 场景 | 测试页面 | 验收指标 |
|------|----------|----------|
| 原生表单填写 | `fixtures/native-form.html` | 3 字段 < 3s |
| AntD 复杂表单 | `fixtures/antd-form.html` | 5 字段 P50 < 5s，P95 < 8s |
| Element UI 表单 | `fixtures/element-form.html` | 5 字段 P50 < 5s，P95 < 8s |
| 大页面元素定位 | `fixtures/large-page.html` | 定位 < 200ms |
| Shadow DOM 操作 | `fixtures/shadow-dom-page.html` | 能穿透定位 |

**运行方式：**
```bash
# 跑基线
pnpm bench -- --update-baseline

# 跑验收（对比基线）
pnpm bench

# 跑 E2E（需要 Chrome 启动）
pnpm test:e2e
```

---

## 🎯 更新后的下一步行动

### 立即可做（今天）：
1. ✅ 阅读并确认本执行计划
2. 🚀 **Quick Win 1**: 修复 `stringToBase64()` O(n²) — 低风险性能修复
3. 🚀 **Quick Win 2**: 添加 `showConfirmationOverlay()` 超时 — 避免 Promise 永不 resolve
4. 🚀 **Quick Win 3**: 修复 `publish-release.sh` 硬编码路径 — 提升发布脚本可迁移性
5. 📐 **阶段 0 起步**: 建立 benchmark 输出格式与 `baseline.json` 结构

### 本周目标：
- 完成阶段 0（基线度量）和 Quick Wins
- 实现最小闭环：`benchmark -> includeForms 表单模型 -> native/AntD select smart fill -> verify -> report`
- 验收：基线数据可用，3 字段填表 P50 < 5s，失败字段可单独报告

### 本月目标：
- 完成阶段 0 至阶段四
- 核心路径有重试和可序列化错误码
- 工具治理完成 v0.4 目标：推荐入口明确、deprecated warning 可控、描述 token 减少 15%+
- getPageModel() 耗时降 60%

### 季度目标：
- 完成所有八个阶段
- 单元测试覆盖核心算法 > 80%
- 达到全部性能指标

---

**优化优先级总览：**

| 优先级 | 任务 | 预期收益 |
|--------|------|----------|
| 🔴 P0 | 阶段 0：基线度量 + Vitest + Feature Flag | 所有后续优化的验证基础 |
| 🔴 P0 | Smart Form Engine | 填表耗时 -70% |
| 🔴 P0 | 可序列化结构化错误码 | 后续开发效率基础 |
| 🔴 P0 | 工具治理 v0.4 | LLM token -15% 起，避免破坏兼容 |
| 🔴 P0 | WebSocket 心跳+重连 | 连接可靠性 |
| 🔴 P0 | getActionableElements 缓存 | getPageModel -60% |
| 🟡 P1 | 指数退避重试 | 瞬时失败恢复 |
| 🟡 P1 | 响应体压缩 | 传输效率 +30% |
| 🟡 P1 | scoreElements 优化 | 定位准确率 +15% |
| 🟡 P1 | navigate_and_observe | 往返次数 -50% |
| 🟢 P2 | 审计日志批量写入 | 存储 I/O -90% |
| 🟢 P2 | Shadow DOM 注册表 | 深层查询性能 |
| 🟢 P2 | storage 缓存 | 异步开销减少 |

---

**准备好开始了吗？建议从阶段 0 开始，先建立度量基线，再动手优化！** 🚀
