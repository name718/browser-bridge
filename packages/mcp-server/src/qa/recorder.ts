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

    if (previous && previous.action === "type" && normalized.action === "type" && sameTarget(previous, normalized)) {
      result[result.length - 1] = { ...previous, ...normalized };
      continue;
    }

    if (previous && previous.action === "scroll" && normalized.action === "scroll" && previous.direction === normalized.direction) {
      previous.amount = (previous.amount ?? 0) + (normalized.amount ?? 0);
      continue;
    }

    if (normalized.action === "click" && !normalized.text && !normalized.selector && !normalized.ariaLabel && !normalized.placeholder && !normalized.testId) {
      continue;
    }

    result.push(normalized);
  }
  return result;
}

function normalizeRecordedStep(step: RecordedStep): RecordedStep {
  const action = step.action === "change" || step.action === "input" ? "type" : step.action;
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
  if (step.action === "select") return { action: "type", ...target, value: step.value ?? "", replace: true };
  if (step.action === "check" || step.action === "uncheck") return { action: "click", ...target };
  if (step.action === "pressKey" && step.key) return { action: "pressKey", key: step.key };
  if (step.action === "scroll") return { action: "scroll", direction: step.direction ?? "down", amount: step.amount };
  if (step.action === "waitFor") return { action: "waitFor", ...target, text: step.text };
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
  const value = `${step.placeholder ?? ""} ${step.ariaLabel ?? ""} ${step.text ?? ""}`;
  return /password|密码|token|secret|验证码|verification/i.test(value);
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
