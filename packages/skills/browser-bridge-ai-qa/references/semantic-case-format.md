# Semantic Test Case Format

Use this format for human review. Keep cases semantic and Chinese-first; avoid raw selectors, implementation details, or Browser Bridge tool names.

```markdown
## TC-001 标题
- 优先级：P0/P1/P2
- 类型：新需求 / 回归 / 边界 / 异常 / 权限 / 数据状态 / 冒烟
- 覆盖点：对应 PRD 验收点或影响点
- 前置条件：登录角色、数据状态、入口页面、环境
- 操作步骤：
  1. 用户进入...
  2. 用户选择/输入...
  3. 用户点击...
- 预期结果：页面文案、列表结果、状态变化、接口/数据影响、错误提示
- 证据要求：截图位置、需要观察的 console/network 信息
```

Rules:
- One case covers one clear behavior or risk.
- P0 must cover核心成功链路、关键回归链路、权限/数据安全风险。
- Add regression cases from code impact, not only from PRD happy path.
- Mark unclear assumptions explicitly instead of inventing hidden data.
