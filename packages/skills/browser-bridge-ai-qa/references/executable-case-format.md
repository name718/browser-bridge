# Executable Case Format

Generate executable cases only after semantic cases are approved. Preserve traceability.

Preferred structure:

```json
{
  "id": "TC-001",
  "title": "语义化标题",
  "priority": "P0",
  "tags": ["new", "regression"],
  "expected": ["页面应展示...", "console 不应出现 error/exception"],
  "steps": [
    { "action": "open", "url": "https://..." },
    { "action": "selectOption", "target": "费用类型", "value": "退回费" },
    { "action": "selectOption", "target": "业务类型", "value": "运力开放平台" },
    { "action": "click", "target": "查询" },
    { "action": "assertVisible", "target": "结果列表" },
    { "action": "screenshot", "name": "query-result" }
  ]
}
```

Rules:
- Prefer visible label/text/role targets over brittle CSS selectors.
- Include assertions, not just operations.
- Include screenshot steps for important states.
- Add console expectation through QA run options: `captureConsole: true`, `failOnConsoleError: true`, `failOnUncaughtException: true`.
- If data setup is required and cannot be automated safely, mark the case blocked with a clear precondition.
