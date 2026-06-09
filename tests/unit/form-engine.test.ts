import { describe, it, expect } from "vitest";
import type {
  Framework,
  FieldType,
  FieldSource,
  FormFieldInfo,
  FieldFillRequest,
  FieldResult,
  FillResult,
} from "../../packages/extension/src/content/form-engine";

describe("Form Engine types", () => {
  it("should define Framework type correctly", () => {
    const frameworks: Framework[] = ["antd", "element-ui", "arco", "native"];
    expect(frameworks.length).toBe(4);
  });

  it("should define FieldType type correctly", () => {
    const types: FieldType[] = [
      "input", "textarea", "select", "date-picker", "date-range",
      "checkbox", "radio", "switch", "tree-select", "cascader", "upload", "unknown"
    ];
    expect(types.length).toBe(12);
  });

  it("should define FieldSource type correctly", () => {
    const sources: FieldSource[] = [
      "label-for", "form-item", "aria", "spatial", "placeholder", "name-attr"
    ];
    expect(sources.length).toBe(6);
  });

  it("should create valid FormFieldInfo object", () => {
    const field: FormFieldInfo = {
      id: "test-field",
      label: "用户名",
      type: "input",
      framework: "native",
      required: true,
      placeholder: "请输入用户名",
      sensitive: false,
      source: "label-for",
      confidence: 0.8,
      warnings: [],
    };

    expect(field.id).toBe("test-field");
    expect(field.label).toBe("用户名");
    expect(field.confidence).toBeGreaterThanOrEqual(0);
    expect(field.confidence).toBeLessThanOrEqual(1);
  });

  it("should create valid FieldFillRequest object", () => {
    const request: FieldFillRequest = {
      label: "用户名",
      value: "testuser",
    };
    expect(request.label).toBe("用户名");
    expect(request.value).toBe("testuser");
  });

  it("should create valid FillResult object", () => {
    const result: FillResult = {
      filled: 2,
      failed: 1,
      results: [
        { field: "用户名", success: true, verified: true },
        { field: "邮箱", success: true, verified: true },
        { field: "手机号", success: false, error: "未找到字段" },
      ],
      durationMs: 1500,
    };

    expect(result.filled + result.failed).toBe(3);
    expect(result.results.length).toBe(3);
  });
});
