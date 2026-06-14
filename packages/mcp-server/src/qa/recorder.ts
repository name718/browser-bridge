import { type BrowserStep } from "@majuntao-1/browser-bridge-shared";
import { safeName } from "./artifacts.js";
import { type QaCaseInput, type RecordedStep } from "./types.js";

export function recordedStepsToCase(
  steps: RecordedStep[],
  options: { id?: string; title?: string; expected?: string[] } = {}
): QaCaseInput {
  const cleaned = cleanRecordedSteps(steps);
  const browserSteps = cleaned.map(recordedToBrowserStep).filter((step): step is BrowserStep => Boolean(step));
  const lastUrl = [...cleaned].reverse().find((step: RecordedStep) => step.url)?.url;

  if (lastUrl && browserSteps[0]?.action !== "open") {
    browserSteps.unshift({ action: "open", url: lastUrl });
  }

  if (!browserSteps.some((step) => step.action === "screenshot")) {
    browserSteps.push({ action: "screenshot" });
  }

  return {
    id: safeName(options.id ?? options.title ?? "recorded-flow"),
    title: options.title ?? "录制流程回放",
    priority: "P1",
    type: "recorded",
    expected: options.expected ?? ["录制流程可以成功回放"],
    steps: browserSteps
  };
}

export function cleanRecordedSteps(steps: RecordedStep[]): RecordedStep[] {
  const result: RecordedStep[] = [];
  for (const step of steps) {
    if (!step || !step.action) continue;
    const normalized = normalizeRecordedStep(step);
    const previous = result[result.length - 1];

    // 合并连续的输入操作
    if (previous && previous.action === "type" && normalized.action === "type" && sameTarget(previous, normalized)) {
      result[result.length - 1] = { ...previous, ...normalized };
      continue;
    }

    // 优化：合并点击输入框后立即输入的行为，这是 Agent 常用的模式
    if (previous && previous.action === "click" && normalized.action === "type" && sameTarget(previous, normalized)) {
      result[result.length - 1] = { ...normalized }; // 直接替换为 type，因为 type 包含点击动作
      continue;
    }

    // 合并连续滚动
    if (previous && previous.action === "scroll" && normalized.action === "scroll" && previous.direction === normalized.direction) {
      previous.amount = (previous.amount ?? 0) + (normalized.amount ?? 0);
      continue;
    }

    // 过滤掉没有目标的无效点击
    if (normalized.action === "click" && !normalized.text && !normalized.selector && !normalized.ariaLabel && !normalized.placeholder && !normalized.testId) {
      // 保留有坐标信息的点击（可能是 canvas 点击）
      if (!normalized.nearText) {
        continue;
      }
    }

    result.push(normalized);
  }
  return result;
}

function normalizeRecordedStep(step: RecordedStep): RecordedStep {
  let action = step.action;
  if (action === "change" || action === "input") action = "type";
  
  return {
    ...step,
    action,
    value: isSensitive(step) ? undefined : step.value,
    masked: step.masked || isSensitive(step)
  };
}

function recordedToBrowserStep(step: RecordedStep): BrowserStep | undefined {
  const target = targetFields(step);
  if (step.action === "open" && step.url) return { action: "open", url: step.url };
  if (step.action === "click") return { action: "click", ...target };
  if (step.action === "type") return { action: "type", ...target, value: step.value ?? "", replace: true };
  
  // 对于 select，我们优先尝试 selectOption，因为它更稳定
  if (step.action === "select") {
    return { 
      action: "selectOption", 
      label: step.nearText || step.ariaLabel || step.placeholder, 
      option: step.value 
    };
  }
  
  if (step.action === "check" || step.action === "uncheck") return { action: "click", ...target };
  if (step.action === "pressKey" && step.key) return { action: "pressKey", key: step.key };
  if (step.action === "scroll") return { action: "scroll", direction: step.direction ?? "down", amount: step.amount };
  if (step.action === "waitFor") return { action: "waitFor", ...target, text: step.text };
  if (step.action === "submit") return { action: "pressKey", key: "Enter", ...target };
  
  return undefined;
}

function targetFields(step: RecordedStep): Partial<BrowserStep> {
  return {
    text: step.text,
    query: step.query,
    role: step.role,
    ariaLabel: step.ariaLabel,
    placeholder: step.placeholder,
    selector: step.testId ? `[data-testid="${cssEscape(step.testId)}"]` : step.selector ?? step.selectorHint,
    nearText: step.nearText
  };
}

function sameTarget(a: RecordedStep, b: RecordedStep): boolean {
  return Boolean(
    (a.testId && a.testId === b.testId) ||
    (a.selector && a.selector === b.selector) ||
    (a.placeholder && a.placeholder === b.placeholder) ||
    (a.ariaLabel && a.ariaLabel === b.ariaLabel)
  );
}

function isSensitive(step: RecordedStep): boolean {
  const fieldText = `${step.placeholder ?? ""} ${step.ariaLabel ?? ""} ${step.text ?? ""}`;

  // 1. 文本模式匹配
  const patterns = [
    /password/i, /密码/i, /secret/i, /token/i,
    /验证码/, /verification/i, /credit.?card/i,
    /信用卡/, /身份证/, /银行卡/
  ];
  if (patterns.some((p) => p.test(fieldText))) return true;

  // 2. input type 检测（通过 selector 推断）
  if (step.selector?.includes("type=password")) return true;

  // 3. value 内容检测（如果看起来像敏感数据）
  const value = step.value ?? "";
  // 信用卡号：16-19 位连续数字
  if (/[\d]{16,19}/.test(value)) return true;
  // 身份证号：18 位
  if (/[\d]{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[\dXx]{4}/.test(value)) return true;

  return false;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
