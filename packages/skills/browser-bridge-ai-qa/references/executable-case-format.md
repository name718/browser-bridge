# Executable Case Format

Generate executable cases only after semantic cases are approved. Preserve traceability.

Preferred `browser_qa_run` structure:

```json
{
  "taskId": "refund-flow",
  "title": "退款流程自动化测试",
  "baseUrl": "https://staging.example.com",
  "cases": [
    {
      "id": "TC-001",
      "title": "用户可以提交合法退款金额",
      "priority": "P0",
      "expected": ["页面展示退款中", "console 不出现 error/exception", "核心接口不返回 4xx/5xx"],
      "steps": [
        { "action": "open", "url": "https://staging.example.com/refund?orderId=123" },
        {
          "action": "type",
          "locator": {
            "testId": "refund-amount",
            "label": "退款金额",
            "placeholder": "退款金额"
          },
          "value": "10.00",
          "replace": true
        },
        {
          "action": "click",
          "locator": {
            "role": "button",
            "text": "提交"
          }
        },
        { "action": "assertText", "contains": "退款中" }
      ]
    }
  ],
  "observe": {
    "before": ["pageModel"],
    "afterEachStep": false,
    "onFailure": ["screenshot", "console", "network", "pageModel"],
    "final": ["screenshot", "console"]
  },
  "diagnostics": {
    "failOnConsoleError": true,
    "failOnUncaughtException": true,
    "failOnNetworkError": true,
    "slowRequestThresholdMs": 1000
  },
  "summaryOnly": true
}
```

Rules:
- Prefer `locator` over raw selector fields.
- Fill multiple locator hints when possible: `testId`, `label`, `role`, `text`, `placeholder`, `ariaLabel`, `nearText`.
- Use CSS selectors only when semantic locators are unavailable or the source code exposes stable test ids through selector hints.
- Include assertions, not just operations.
- Do not add screenshot steps for every state. Use `observe.final` and `observe.onFailure` instead.
- Add console/network expectations through `diagnostics`, not through ad hoc manual checks.
- Preserve traceability by keeping executable case ids aligned with semantic case ids.
- If data setup is required and cannot be automated safely, mark the case blocked with a clear precondition.
