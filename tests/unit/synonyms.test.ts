import { describe, it, expect } from "vitest";
import {
  SYNONYM_MAP,
  getSynonyms,
  areSynonyms,
} from "../../packages/extension/src/content/synonyms";

describe("SYNONYM_MAP", () => {
  it("should have entries for common Chinese operations", () => {
    expect(SYNONYM_MAP["查询"]).toBeDefined();
    expect(SYNONYM_MAP["保存"]).toBeDefined();
    expect(SYNONYM_MAP["取消"]).toBeDefined();
    expect(SYNONYM_MAP["删除"]).toBeDefined();
  });

  it("should have entries for common form fields", () => {
    expect(SYNONYM_MAP["用户名"]).toBeDefined();
    expect(SYNONYM_MAP["密码"]).toBeDefined();
    expect(SYNONYM_MAP["邮箱"]).toBeDefined();
  });

  it("should not have empty synonym arrays", () => {
    for (const [key, synonyms] of Object.entries(SYNONYM_MAP)) {
      expect(synonyms.length, `${key} should have synonyms`).toBeGreaterThan(0);
    }
  });
});

describe("getSynonyms", () => {
  it("should return synonyms for known words", () => {
    const synonyms = getSynonyms("查询");
    expect(synonyms).toContain("搜索");
    expect(synonyms).toContain("检索");
    expect(synonyms).toContain("筛选");
  });

  it("should return synonyms for English words", () => {
    const synonyms = getSynonyms("save");
    expect(synonyms.length).toBeGreaterThan(0);
  });

  it("should do reverse lookup", () => {
    // "搜索" is a synonym of "查询", so getSynonyms("搜索") should return "查询" + other synonyms
    const synonyms = getSynonyms("搜索");
    expect(synonyms).toContain("查询");
  });

  it("should return empty array for unknown words", () => {
    const synonyms = getSynonyms("xyznotaword");
    expect(synonyms).toEqual([]);
  });

  it("should be case-insensitive", () => {
    const lower = getSynonyms("save");
    const upper = getSynonyms("SAVE");
    expect(lower.length).toBe(upper.length);
  });
});

describe("areSynonyms", () => {
  it("should return true for same word", () => {
    expect(areSynonyms("查询", "查询")).toBe(true);
  });

  it("should return true for synonyms", () => {
    expect(areSynonyms("查询", "搜索")).toBe(true);
    expect(areSynonyms("保存", "确认")).toBe(true);
    expect(areSynonyms("取消", "关闭")).toBe(true);
  });

  it("should be symmetric", () => {
    expect(areSynonyms("查询", "搜索")).toBe(true);
    expect(areSynonyms("搜索", "查询")).toBe(true);
  });

  it("should return false for unrelated words", () => {
    expect(areSynonyms("查询", "删除")).toBe(false);
  });

  it("should be case-insensitive", () => {
    expect(areSynonyms("save", "SAVE")).toBe(true);
  });
});

describe("synonym safety", () => {
  it("should not have '保存' as synonym of dangerous operations", () => {
    // "保存" should NOT be a synonym of "删除"
    expect(areSynonyms("保存", "删除")).toBe(false);
  });

  it("should not have '确认' as synonym of '删除'", () => {
    // This tests that synonym matching won't accidentally match dangerous actions
    expect(areSynonyms("确认", "删除")).toBe(false);
  });
});
