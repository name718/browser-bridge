import { describe, it, expect } from "vitest";
import {
  isRecord,
  isSensitive,
  isSensitiveValue,
  deepMerge,
  isHighRiskText,
  HIGH_RISK_TEXT_PATTERNS,
} from "../../packages/shared/src/utils";

describe("isRecord", () => {
  it("should return true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("should return false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("should return false for arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  it("should return false for primitives", () => {
    expect(isRecord(42)).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("isSensitive", () => {
  it("should detect password input type", () => {
    expect(isSensitive({ inputType: "password" })).toBe(true);
  });

  it("should detect password in placeholder", () => {
    expect(isSensitive({ placeholder: "请输入密码" })).toBe(true);
  });

  it("should detect password in English", () => {
    expect(isSensitive({ placeholder: "Enter password" })).toBe(true);
  });

  it("should detect token in aria-label", () => {
    expect(isSensitive({ ariaLabel: "API token" })).toBe(true);
  });

  it("should detect 信用卡 in text", () => {
    expect(isSensitive({ text: "信用卡号" })).toBe(true);
  });

  it("should detect 身份证 in text", () => {
    expect(isSensitive({ text: "身份证号码" })).toBe(true);
  });

  it("should detect 验证码 in text", () => {
    expect(isSensitive({ text: "验证码" })).toBe(true);
  });

  it("should not flag normal fields", () => {
    expect(isSensitive({ placeholder: "请输入用户名" })).toBe(false);
    expect(isSensitive({ text: "邮箱地址" })).toBe(false);
    expect(isSensitive({ inputType: "text" })).toBe(false);
  });
});

describe("isSensitiveValue", () => {
  it("should detect credit card numbers", () => {
    expect(isSensitiveValue("4111111111111111")).toBe(true);
    expect(isSensitiveValue("6222021234567890123")).toBe(true);
  });

  it("should detect Chinese ID numbers", () => {
    expect(isSensitiveValue("110101199003074518")).toBe(true);
  });

  it("should not flag normal strings", () => {
    expect(isSensitiveValue("hello")).toBe(false);
    expect(isSensitiveValue("12345")).toBe(false);
    expect(isSensitiveValue("test@example.com")).toBe(false);
  });
});

describe("deepMerge", () => {
  it("should merge flat objects", () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("should merge nested objects recursively", () => {
    const result = deepMerge(
      { a: { x: 1, y: 2 }, b: 1 },
      { a: { y: 3, z: 4 } }
    );
    expect(result).toEqual({ a: { x: 1, y: 3, z: 4 }, b: 1 });
  });

  it("should not mutate original objects", () => {
    const target = { a: { x: 1 } };
    const source = { a: { y: 2 } };
    const result = deepMerge(target, source);

    expect(target).toEqual({ a: { x: 1 } });
    expect(result).toEqual({ a: { x: 1, y: 2 } });
  });

  it("should handle empty source", () => {
    const result = deepMerge({ a: 1 }, {});
    expect(result).toEqual({ a: 1 });
  });

  it("should handle empty target", () => {
    const result = deepMerge({}, { a: 1 });
    expect(result).toEqual({ a: 1 });
  });
});

describe("HIGH_RISK_TEXT_PATTERNS", () => {
  it("should have patterns for English dangerous actions", () => {
    const patterns = HIGH_RISK_TEXT_PATTERNS.map((p) => p.source);
    expect(patterns).toContain("delete");
    expect(patterns).toContain("remove");
    expect(patterns).toContain("pay");
    expect(patterns).toContain("submit");
  });

  it("should have patterns for Chinese dangerous actions", () => {
    const patterns = HIGH_RISK_TEXT_PATTERNS.map((p) => p.source);
    expect(patterns).toContain("删除");
    expect(patterns).toContain("支付");
    expect(patterns).toContain("提交");
  });
});

describe("isHighRiskText", () => {
  it("should detect English dangerous actions", () => {
    expect(isHighRiskText("Delete this item")).toBe(true);
    expect(isHighRiskText("Submit the form")).toBe(true);
    expect(isHighRiskText("Pay now")).toBe(true);
  });

  it("should detect Chinese dangerous actions", () => {
    expect(isHighRiskText("确认删除")).toBe(true);
    expect(isHighRiskText("立即支付")).toBe(true);
    expect(isHighRiskText("提交订单")).toBe(true);
  });

  it("should be case-insensitive", () => {
    expect(isHighRiskText("DELETE")).toBe(true);
    expect(isHighRiskText("delete")).toBe(true);
    expect(isHighRiskText("Delete")).toBe(true);
  });

  it("should not flag safe text", () => {
    expect(isHighRiskText("查询")).toBe(false);
    expect(isHighRiskText("查看")).toBe(false);
    expect(isHighRiskText("Search")).toBe(false);
    expect(isHighRiskText("View details")).toBe(false);
  });
});
