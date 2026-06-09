/**
 * Smart Form Engine
 *
 * 智能表单结构提取与批量填写引擎。
 * 支持 AntD、Element UI、Arco、原生 HTML 表单的自动识别和交互。
 *
 * 设计原则：
 * - 优先复用 browser_get_page_model 的返回结构
 * - 返回字段必须包含 confidence、source 和 warnings
 * - 每个字段填写后必须读回验证
 * - 批量填写允许部分成功
 */

// ============================================================
// 类型定义
// ============================================================

export type Framework = "antd" | "element-ui" | "arco" | "native";

export type FieldType =
  | "input"
  | "textarea"
  | "select"
  | "date-picker"
  | "date-range"
  | "checkbox"
  | "radio"
  | "switch"
  | "tree-select"
  | "cascader"
  | "upload"
  | "unknown";

export type FieldSource =
  | "label-for"
  | "form-item"
  | "aria"
  | "spatial"
  | "placeholder"
  | "name-attr";

export interface FormFieldInfo {
  /** 唯一标识（基于 DOM 位置或 id） */
  id: string;
  /** 字段标签文本 */
  label: string;
  /** 字段类型 */
  type: FieldType;
  /** 所属 UI 框架 */
  framework: Framework;
  /** 是否必填 */
  required: boolean;
  /** placeholder 文本 */
  placeholder?: string;
  /** 下拉选项（select/radio 类型） */
  options?: string[];
  /** 当前值 */
  currentValue?: string;
  /** 是否敏感字段（密码、银行卡等） */
  sensitive: boolean;
  /** 标签映射来源 */
  source: FieldSource;
  /** 置信度 0-1 */
  confidence: number;
  /** 警告信息 */
  warnings: string[];
}

export interface FormStructure {
  /** 页面上检测到的所有表单 */
  forms: Array<{
    id: string;
    action?: string;
    method?: string;
    fieldCount: number;
  }>;
  /** 所有表单字段 */
  fields: FormFieldInfo[];
  /** 检测到的 UI 框架 */
  framework: Framework;
  /** 提取耗时（ms） */
  durationMs: number;
}

export interface FieldFillRequest {
  /** 字段标签（如"用户名"、"开始日期"） */
  label: string;
  /** 要填写的值 */
  value: string;
  /** 可选：直接指定选择器 */
  selector?: string;
  /** 可选：直接指定元素 ID */
  elementId?: string;
  /** 是否替换现有值（默认 true） */
  replace?: boolean;
}

export interface FieldResult {
  field: string;
  success: boolean;
  element?: string;
  error?: string;
  verified?: boolean;
  actualValue?: string;
}

export interface FillResult {
  filled: number;
  failed: number;
  results: FieldResult[];
  durationMs: number;
}

// ============================================================
// 框架检测器
// ============================================================

/**
 * 检测页面使用的 UI 框架（多维度检测）
 */
export function detectFramework(): Framework {
  // 维度 1: 全局变量检测（最可靠）
  if ((window as any).__ANTD_VERSION__ || (window as any).__umi?.antd) return "antd";
  if ((window as any).__ELEMENT_UI__ || (window as any).__ELEMENT_PLUS__) return "element-ui";
  if ((window as any).__ARCO_DESIGN__) return "arco";

  // 维度 2: CSS 类名前缀
  if (document.querySelector('[class*="ant-app"], .ant-design-pro')) return "antd";
  if (document.querySelector('[class*="el-app"], .el-config-provider')) return "element-ui";
  if (document.querySelector('[class*="arco-app"], .arco-config-provider')) return "arco";

  // 维度 3: data-* 属性检测
  if (document.querySelector('[data-testid*="ant-"]')) return "antd";
  if (document.querySelector('[data-v-]')) return "element-ui"; // Vue scoped CSS

  // 维度 4: DOM 结构指纹（特定组件的标志性结构）
  if (document.querySelector(".ant-select-dropdown, .ant-picker-dropdown, .ant-modal")) return "antd";
  if (document.querySelector(".el-select-dropdown, .el-picker-panel, .el-dialog")) return "element-ui";
  if (document.querySelector(".arco-select-dropdown, .arco-picker-dropdown")) return "arco";

  return "native";
}

// ============================================================
// 表单结构提取
// ============================================================

const FORM_ITEM_SELECTORS = [
  ".ant-form-item",
  ".arco-form-item",
  ".el-form-item",
  "[class*='form-item']",
  "[class*='FormItem']",
  "[class*='field']",
  "[class*='Field']",
  ".form-group",
  "fieldset",
];

const LABEL_SELECTORS = [
  "label",
  ".ant-form-item-label",
  ".arco-form-label-item",
  ".el-form-item__label",
  "[class*='form-label']",
  "[class*='FormLabel']",
  "[class*='field-label']",
  "[class*='FieldLabel']",
];

/**
 * 提取页面表单结构
 */
export function getFormStructure(): FormStructure {
  const start = Date.now();
  const framework = detectFramework();

  // 检测表单元素
  const formElements = Array.from(document.querySelectorAll("form"));
  const forms = formElements.map((form, index) => ({
    id: form.id || form.getAttribute("name") || `form-${index}`,
    action: form.action || undefined,
    method: form.method || undefined,
    fieldCount: 0, // 稍后填充
  }));

  // 提取所有表单字段
  const fields: FormFieldInfo[] = [];
  const processedElements = new Set<HTMLElement>();

  // 策略 1: 通过 form-item 容器提取
  for (const selector of FORM_ITEM_SELECTORS) {
    const items = Array.from(document.querySelectorAll(selector));
    for (const item of items) {
      if (processedElements.has(item as HTMLElement)) continue;
      const field = extractFieldFromFormItem(item as HTMLElement, framework);
      if (field) {
        fields.push(field);
        processedElements.add(item as HTMLElement);
      }
    }
  }

  // 策略 2: 通过 label[for] 提取
  const labels = Array.from(document.querySelectorAll("label[for]"));
  for (const label of labels) {
    const forId = label.getAttribute("for");
    if (!forId) continue;
    const control = document.getElementById(forId);
    if (!control || processedElements.has(control)) continue;
    const field = extractFieldFromControl(control, label.textContent || "", framework);
    if (field) {
      fields.push(field);
      processedElements.add(control);
    }
  }

  // 策略 3: 通过可交互元素提取（兜底）
  const interactiveSelectors = "input, select, textarea, [role='textbox'], [role='combobox'], [role='listbox'], [contenteditable]";
  const interactives = Array.from(document.querySelectorAll(interactiveSelectors));
  for (const el of interactives) {
    if (processedElements.has(el as HTMLElement)) continue;
    if (!isVisible(el as HTMLElement)) continue;
    const field = extractFieldFromControl(el as HTMLElement, "", framework);
    if (field) {
      fields.push(field);
      processedElements.add(el as HTMLElement);
    }
  }

  // 更新表单字段计数
  for (const form of forms) {
    const formEl = formElements.find((f) => (f.id || f.getAttribute("name") || `form-${forms.indexOf(form)}`) === form.id);
    if (formEl) {
      form.fieldCount = fields.filter((f) => {
        const fieldEl = document.getElementById(f.id);
        return fieldEl && formEl.contains(fieldEl);
      }).length;
    }
  }

  return {
    forms,
    fields,
    framework,
    durationMs: Date.now() - start,
  };
}

/**
 * 从 form-item 容器提取字段信息
 */
function extractFieldFromFormItem(item: HTMLElement, framework: Framework): FormFieldInfo | null {
  // 查找标签
  let label = "";
  for (const selector of LABEL_SELECTORS) {
    const labelEl = item.querySelector(selector);
    if (labelEl) {
      label = (labelEl.textContent || "").replace(/[:\s：]*$/, "").trim();
      break;
    }
  }

  // 查找控件
  const control = findControlInContainer(item);
  if (!control) return null;

  return buildFieldInfo(control, label, framework, "form-item");
}

/**
 * 从控件元素提取字段信息
 */
function extractFieldFromControl(
  control: HTMLElement,
  labelHint: string,
  framework: Framework
): FormFieldInfo | null {
  // 尝试从关联的 label 获取标签
  let label = labelHint;
  if (!label) {
    label = findLabelForControl(control);
  }

  return buildFieldInfo(control, label, framework, label ? "aria" : "spatial");
}

/**
 * 在容器内查找可交互控件
 */
function findControlInContainer(container: HTMLElement): HTMLElement | null {
  const selectors = [
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "[role='combobox']",
    "[role='textbox']",
    "[role='listbox']",
    "[contenteditable='true']",
    ".ant-select",
    ".arco-select",
    ".el-select",
    ".ant-picker",
    ".el-date-picker",
    "[class*='select']",
    "[class*='Select']",
  ];

  for (const selector of selectors) {
    const el = container.querySelector(selector) as HTMLElement | null;
    if (el && isVisible(el)) return el;
  }
  return null;
}

/**
 * 查找控件关联的标签文本
 */
function findLabelForControl(control: HTMLElement): string {
  // 1. aria-label
  const ariaLabel = control.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  // 2. aria-labelledby
  const labelledBy = control.getAttribute("aria-labelledby");
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent || "";
  }

  // 3. placeholder
  const placeholder = control.getAttribute("placeholder");
  if (placeholder) return placeholder;

  // 4. 上方或左侧的文本（空间距离关联）
  const rect = control.getBoundingClientRect();
  const nearbyElements = Array.from(document.querySelectorAll("label, span, div, p"));
  let closest: { el: Element; dist: number } | null = null;

  for (const el of nearbyElements) {
    const text = (el.textContent || "").trim();
    if (!text || text.length > 50) continue;
    const elRect = el.getBoundingClientRect();
    // 在上方或左侧 50px 内
    const dx = elRect.right - rect.left;
    const dy = elRect.bottom - rect.top;
    if (dx >= -50 && dx <= rect.width + 50 && dy >= -50 && dy <= 0) {
      const dist = Math.abs(dx) + Math.abs(dy);
      if (!closest || dist < closest.dist) {
        closest = { el, dist };
      }
    }
  }

  return closest ? (closest.el.textContent || "").trim() : "";
}

/**
 * 构建字段信息对象
 */
function buildFieldInfo(
  control: HTMLElement,
  label: string,
  framework: Framework,
  source: FieldSource
): FormFieldInfo {
  const type = inferFieldType(control);
  const sensitive = isSensitiveField(control);
  const required = control.hasAttribute("required") ||
    control.getAttribute("aria-required") === "true" ||
    !!control.closest("[class*='required']");

  const options = extractOptions(control);
  const currentValue = getControlValue(control);
  const warnings: string[] = [];

  // 置信度计算
  let confidence = 0.5;
  if (label) confidence += 0.2;
  if (source === "label-for" || source === "form-item") confidence += 0.2;
  if (control.id) confidence += 0.1;
  if (sensitive) warnings.push("敏感字段，需要用户确认");

  return {
    id: control.id || generateFieldId(control),
    label: label || "(未命名字段)",
    type,
    framework,
    required,
    placeholder: control.getAttribute("placeholder") || undefined,
    options: options.length > 0 ? options : undefined,
    currentValue,
    sensitive,
    source,
    confidence: Math.min(confidence, 1),
    warnings,
  };
}

/**
 * 推断字段类型
 */
function inferFieldType(control: HTMLElement): FieldType {
  if (control instanceof HTMLSelectElement) return "select";
  if (control instanceof HTMLTextAreaElement) return "textarea";
  if (control instanceof HTMLInputElement) {
    const type = control.type.toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "date" || type === "datetime-local") return "date-picker";
    if (type === "file") return "upload";
    return "input";
  }

  // 框架组件检测
  const classList = control.className.toString();
  if (classList.includes("select") || classList.includes("Select")) return "select";
  if (classList.includes("picker") || classList.includes("Picker") || classList.includes("date")) return "date-picker";
  if (classList.includes("tree") || classList.includes("Tree")) return "tree-select";
  if (classList.includes("cascader") || classList.includes("Cascader")) return "cascader";
  if (classList.includes("switch") || classList.includes("Switch")) return "switch";
  if (control.getAttribute("role") === "combobox") return "select";

  return "input";
}

/**
 * 检测敏感字段
 */
function isSensitiveField(control: HTMLElement): boolean {
  if (control instanceof HTMLInputElement && control.type === "password") return true;

  const text = [
    control.getAttribute("placeholder"),
    control.getAttribute("aria-label"),
    control.getAttribute("name"),
    control.id,
  ].filter(Boolean).join(" ");

  const patterns = [/password/i, /密码/i, /secret/i, /token/i, /验证码/, /credit.?card/i, /信用卡/, /身份证/];
  return patterns.some((p) => p.test(text));
}

/**
 * 提取下拉选项
 */
function extractOptions(control: HTMLElement): string[] {
  // 原生 select
  if (control instanceof HTMLSelectElement) {
    return Array.from(control.options).map((o) => o.textContent || o.value).filter(Boolean);
  }
  return [];
}

/**
 * 获取控件当前值
 */
function getControlValue(control: HTMLElement): string | undefined {
  if (control instanceof HTMLInputElement) return control.value || undefined;
  if (control instanceof HTMLSelectElement) return control.value || undefined;
  if (control instanceof HTMLTextAreaElement) return control.value || undefined;
  return undefined;
}

/**
 * 生成字段 ID
 */
function generateFieldId(control: HTMLElement): string {
  const tag = control.tagName.toLowerCase();
  const name = control.getAttribute("name") || "";
  const type = control.getAttribute("type") || "";
  const index = Array.from(document.querySelectorAll(`${tag}[name='${name}']`)).indexOf(control);
  return `${tag}-${name}-${type}-${index}`.replace(/^-/, "");
}

/**
 * 元素可见性检测
 */
function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity) > 0;
}

// ============================================================
// 组件交互策略
// ============================================================

export interface ComponentStrategy {
  /** 检测元素是否匹配此策略 */
  detect(element: HTMLElement): boolean;
  /** 打开组件（如下拉框） */
  open(element: HTMLElement): Promise<void>;
  /** 选择/填写值 */
  choose(element: HTMLElement, value: string): Promise<void>;
  /** 验证值是否正确 */
  verify(element: HTMLElement, expected: string): Promise<boolean>;
  /** 回滚操作（可选） */
  rollback?(element: HTMLElement): Promise<void>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 原生 input 策略
 */
const nativeInputStrategy: ComponentStrategy = {
  detect: (el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement,

  open: async () => { /* input 不需要 open */ },

  choose: async (el, value) => {
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  },

  verify: async (el, expected) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.value === expected || el.value.includes(expected);
    }
    return false;
  },
};

/**
 * 原生 select 策略
 */
const nativeSelectStrategy: ComponentStrategy = {
  detect: (el) => el instanceof HTMLSelectElement,

  open: async (el) => {
    el.focus();
    el.click();
    await delay(100);
  },

  choose: async (el, value) => {
    if (!(el instanceof HTMLSelectElement)) return;
    const normalized = value.toLowerCase().trim();
    const option = Array.from(el.options).find((o) => {
      const text = (o.textContent || o.value).toLowerCase().trim();
      return text === normalized || text.includes(normalized);
    });
    if (option) {
      el.value = option.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  },

  verify: async (el, expected) => {
    if (el instanceof HTMLSelectElement) {
      const selected = el.options[el.selectedIndex];
      const text = (selected?.textContent || "").toLowerCase().trim();
      return text.includes(expected.toLowerCase().trim());
    }
    return false;
  },
};

/**
 * AntD Select 策略
 */
const antdSelectStrategy: ComponentStrategy = {
  detect: (el) =>
    el.classList.contains("ant-select") ||
    el.querySelector(".ant-select-selector") !== null,

  open: async (el) => {
    const selector = el.querySelector(".ant-select-selector") as HTMLElement | null;
    if (selector) {
      selector.click();
      await delay(300);
    }
  },

  choose: async (el, value) => {
    const normalized = value.toLowerCase().trim();

    // 等待下拉面板出现
    const dropdown = document.querySelector(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
    if (!dropdown) {
      // 如果没打开，先打开
      await antdSelectStrategy.open(el);
      await delay(300);
    }

    // 查找选项
    const options = document.querySelectorAll(".ant-select-item-option");
    const target = Array.from(options).find((opt) => {
      const text = (opt.textContent || "").toLowerCase().trim();
      return text === normalized || text.includes(normalized);
    });

    if (target) {
      (target as HTMLElement).click();
      await delay(200);
    }
  },

  verify: async (el, expected) => {
    const selected = el.querySelector(".ant-select-selection-item, .ant-select-selection-placeholder");
    const text = (selected?.textContent || "").toLowerCase().trim();
    return text.includes(expected.toLowerCase().trim());
  },
};

/**
 * Element UI Select 策略
 */
const elementSelectStrategy: ComponentStrategy = {
  detect: (el) =>
    el.classList.contains("el-select") ||
    el.querySelector(".el-select__wrapper") !== null,

  open: async (el) => {
    const wrapper = el.querySelector(".el-select__wrapper, .el-input__inner") as HTMLElement | null;
    if (wrapper) {
      wrapper.click();
      await delay(300);
    }
  },

  choose: async (el, value) => {
    const normalized = value.toLowerCase().trim();

    await elementSelectStrategy.open(el);
    await delay(300);

    const options = document.querySelectorAll(".el-select-dropdown__item");
    const target = Array.from(options).find((opt) => {
      const text = (opt.textContent || "").toLowerCase().trim();
      return text === normalized || text.includes(normalized);
    });

    if (target) {
      (target as HTMLElement).click();
      await delay(200);
    }
  },

  verify: async (el, expected) => {
    const selected = el.querySelector(".el-select__selected-item, .el-input__inner") as HTMLInputElement | null;
    if (selected) {
      const text = (selected.value || selected.textContent || "").toLowerCase().trim();
      return text.includes(expected.toLowerCase().trim());
    }
    return false;
  },
};

/**
 * 获取所有可用的组件策略
 */
function getStrategies(): ComponentStrategy[] {
  return [
    antdSelectStrategy,
    elementSelectStrategy,
    nativeSelectStrategy,
    nativeInputStrategy, // 兜底策略
  ];
}

/**
 * 检测元素应该使用的策略
 */
function detectStrategy(element: HTMLElement): ComponentStrategy {
  const strategies = getStrategies();
  for (const strategy of strategies) {
    if (strategy.detect(element)) return strategy;
  }
  return nativeInputStrategy; // 默认兜底
}

// ============================================================
// 批量智能填表
// ============================================================

/**
 * 批量智能填写表单
 *
 * @param fields 要填写的字段列表
 * @param options 选项
 * @returns 填写结果
 */
export async function fillFormSmart(
  fields: FieldFillRequest[],
  options: { dryRun?: boolean } = {}
): Promise<FillResult> {
  const start = Date.now();
  const results: FieldResult[] = [];

  for (const field of fields) {
    try {
      // 定位元素
      const element = findFieldElement(field);
      if (!element) {
        results.push({
          field: field.label,
          success: false,
          error: `未找到标签为「${field.label}」的字段`,
        });
        continue;
      }

      // dryRun 模式：只返回匹配信息，不实际填写
      if (options.dryRun) {
        const strategy = detectStrategy(element);
        results.push({
          field: field.label,
          success: true,
          element: element.id || element.tagName,
          verified: false,
        });
        continue;
      }

      // 检测策略并填写
      const strategy = detectStrategy(element);
      await strategy.open(element);
      await delay(100);
      await strategy.choose(element, field.value);
      await delay(200);

      // 验证填写结果
      const verified = await strategy.verify(element, field.value);
      const actualValue = getControlValue(element);

      results.push({
        field: field.label,
        success: true,
        element: element.id || element.tagName,
        verified,
        actualValue,
      });
    } catch (error) {
      results.push({
        field: field.label,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const filled = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    filled,
    failed,
    results,
    durationMs: Date.now() - start,
  };
}

/**
 * 根据字段请求定位 DOM 元素
 */
function findFieldElement(field: FieldFillRequest): HTMLElement | null {
  // 1. 直接指定 elementId
  if (field.elementId) {
    const el = document.getElementById(field.elementId);
    if (el) return el;
  }

  // 2. 直接指定 selector
  if (field.selector) {
    const el = document.querySelector(field.selector) as HTMLElement | null;
    if (el) return el;
  }

  // 3. 通过 label 查找
  return findControlByLabel(field.label);
}

/**
 * 通过标签文本查找控件（复用 content.ts 的逻辑）
 */
function findControlByLabel(label: string): HTMLElement | null {
  const normalizedLabel = label.replace(/\s+/g, " ").trim();

  // 策略 1: label[for] 显式关联
  const labels = Array.from(document.querySelectorAll("label[for]"));
  for (const labelEl of labels) {
    if ((labelEl.textContent || "").includes(normalizedLabel)) {
      const forId = labelEl.getAttribute("for");
      if (forId) {
        const control = document.getElementById(forId);
        if (control && isVisible(control)) return control;
      }
    }
  }

  // 策略 2: 框架 form-item 容器关联
  for (const selector of FORM_ITEM_SELECTORS) {
    const items = Array.from(document.querySelectorAll(selector));
    for (const item of items) {
      const labelEl = item.querySelector(LABEL_SELECTORS.join(","));
      if (labelEl && (labelEl.textContent || "").includes(normalizedLabel)) {
        const control = findControlInContainer(item as HTMLElement);
        if (control) return control;
      }
    }
  }

  // 策略 3: 空间距离关联
  const allControls = Array.from(document.querySelectorAll(
    "input, select, textarea, [role='combobox'], [role='textbox']"
  ));
  for (const control of allControls) {
    const controlLabel = findLabelForControl(control as HTMLElement);
    if (controlLabel.includes(normalizedLabel) && isVisible(control as HTMLElement)) {
      return control as HTMLElement;
    }
  }

  return null;
}
