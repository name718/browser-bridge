# Scripted QA Workflow

Use this workflow when the user asks for branch-based testing, PRD acceptance testing, regression testing, or agent self-testing.

Before executing a staged workflow, read `workflow-state-format.md`. Create or update `.browser-bridge/runs/{taskId}/workflow-state.json` and use it as the source of truth for phase gates.

## Inputs

Collect or infer:

- `baseBranch`: baseline branch, usually `master`.
- `targetBranch`: current or feature branch.
- `baseUrl`: test environment URL.
- `prdText` or PRD link when available.
- `focus`: optional business areas or pages to prioritize.
- Auth/session assumptions.

## State And Gate Discipline

Every phase must update `workflow-state.json`:

- Set the phase to `in_progress` before producing work.
- Set it to `awaiting_confirmation` when output is ready for user review.
- Set the corresponding confirmation phase to `confirmed` only after explicit user confirmation.
- Set a phase to `blocked` when required inputs, auth, environment, or Cooper access are missing.

Do not proceed when a required confirmation is absent:

- Impact analysis requires confirmed requirement.
- Semantic cases require confirmed impact.
- Executable cases require confirmed semantic cases.
- Browser execution requires confirmed executable cases and explicit browser authorization scope.
- Final report requires confirmed run result.

When resuming a workflow, read `workflow-state.json` first and continue from `currentPhase`.

## Phase 1: Source And Diff Analysis

Inspect the repository before opening the browser.

Use git diff and source search to identify:

- Changed files.
- Changed routes/pages.
- Changed components.
- Changed forms, buttons, filters, tables, modals, and state transitions.
- Changed API calls and request/response assumptions.
- Permissions, feature flags, store/state, and data dependencies.
- Old features likely affected by the change.
- Stable locator hints from source: `data-testid`, `data-test`, `data-cy`, labels, placeholders, aria labels, and visible button/link text.

Output an impact report with:

```json
{
  "changedFiles": [],
  "affectedRoutes": [],
  "affectedComponents": [],
  "affectedApis": [],
  "riskPoints": [],
  "regressionAreas": [],
  "selectorHints": []
}
```

## Phase 2: Semantic Cases

Generate human-reviewable semantic cases first. Cover:

- P0 happy paths.
- P0/P1 regression paths from the diff.
- Boundary and negative paths.
- Permission and data-state paths.
- Error handling for changed APIs.

Do not include raw selectors in semantic cases.

## Phase 3: Executable Cases

Convert approved semantic cases into `browser_qa_run` JSON.

Rules:

- Use `locator` objects by default.
- Include multiple locator hints when available.
- Prefer `testId`, `label`, `role + text`, `placeholder`, `ariaLabel`.
- Avoid brittle nth-child selectors.
- Include assertions for each business outcome.
- Use observe/diagnostics policies instead of manual screenshot steps.
- Preserve traceability by matching semantic case ids.

## Phase 4: Batch Execution

Call `browser_qa_run` with approved executable cases.

Default strict policy:

```json
{
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

## Phase 5: Result Analysis

Read the generated summary and diagnostics before answering.

Classify failures as:

- `selector_failed`
- `assertion_failed`
- `console_error`
- `network_error`
- `test_data_error`
- `auth_error`
- `environment_error`
- `execution_error`
- `unknown`

If a case fails because a locator is wrong, inspect the page model and diagnostics, repair the executable script, and rerun only affected cases after user confirmation.

## Final Report

Return a concise summary with:

- Tested scope.
- Passed/failed/blocked counts.
- Failed case ids and failure categories.
- User-facing cause analysis.
- Paths to `report.html`, `summary.json`, diagnostics, screenshots, console, network, and page-model artifacts.
- Remaining gaps or assumptions.
