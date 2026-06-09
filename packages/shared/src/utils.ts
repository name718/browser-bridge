/**
 * 共享工具函数
 *
 * 提取自多个包中的重复实现，统一维护。
 */

/**
 * 类型守卫：检查值是否为非 null、非数组的对象
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 敏感字段检测模式 */
const SENSITIVE_PATTERNS = [
  /password/i,
  /密码/i,
  /secret/i,
  /token/i,
  /验证码/,
  /credit.?card/i,
  /信用卡/,
  /身份证/,
  /银行卡/,
];

/**
 * 检测字段是否为敏感字段
 *
 * 基于 placeholder、aria-label、文本内容和 input type 综合判断。
 */
export function isSensitive(field: {
  placeholder?: string;
  ariaLabel?: string;
  text?: string;
  inputType?: string;
}): boolean {
  // 1. input type 直接判断
  if (field.inputType === "password") return true;

  // 2. 文本模式匹配
  const text = [field.placeholder, field.ariaLabel, field.text]
    .filter(Boolean)
    .join(" ");
  return SENSITIVE_PATTERNS.some((p) => p.test(text));
}

/**
 * 高风险文本模式（中英文）
 *
 * 用于安全检查：检测点击/操作是否涉及危险操作（删除、支付、提交等）。
 * 从 content.ts 和 security.ts 中提取的统一版本。
 */
export const HIGH_RISK_TEXT_PATTERNS: RegExp[] = [
  /delete/i,
  /remove/i,
  /destroy/i,
  /drop/i,
  /pay/i,
  /purchase/i,
  /submit/i,
  /send/i,
  /publish/i,
  /approve/i,
  /reject/i,
  /删除/,
  /移除/,
  /支付/,
  /购买/,
  /提交/,
  /发送/,
  /发布/,
  /审批/,
  /通过/,
  /拒绝/,
];

/**
 * 检测文本是否包含高风险操作模式
 */
export function isHighRiskText(text: string): boolean {
  return HIGH_RISK_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 检测值内容是否包含敏感数据
 */
export function isSensitiveValue(value: string): boolean {
  // 信用卡号：16-19 位连续数字
  if (/[\d]{16,19}/.test(value)) return true;
  // 身份证号：18 位
  if (
    /[\d]{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[\dXx]{4}/.test(
      value
    )
  )
    return true;
  return false;
}

/**
 * 深度合并两个对象（浅拷贝第一层，递归合并嵌套对象）
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (
      isRecord(targetVal) &&
      isRecord(sourceVal)
    ) {
      (result as Record<string, unknown>)[key as string] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      );
    } else if (sourceVal !== undefined) {
      (result as Record<string, unknown>)[key as string] = sourceVal;
    }
  }
  return result;
}
