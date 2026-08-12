# Repo Card Note Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display each repo's current note below its tag selector in a visually distinct, theme-aware container with two-line truncation and an overflow tooltip.

**Architecture:** Keep the existing repo data and save flow unchanged. Extend the existing client-side `RepoCard` presentation with Ant Design `Typography.Paragraph` ellipsis behavior and theme tokens, so the feature remains local to one component and automatically follows light and dark themes.

**Tech Stack:** Next.js 16.2.9 App Router, React 19.2.4, TypeScript 5, Ant Design 6.4.5

## Global Constraints

- Only render the note area when `repo.note` has content.
- Place the note area after `TagSelect` as the final card section.
- Clamp the note to two lines and show the complete note in a tooltip only when truncated.
- Use Ant Design theme tokens instead of hard-coded colors.
- Do not change note editing, persistence, filtering, API behavior, or dependencies.
- Preserve unrelated untracked files `env.prd` and `mise.toml`.

---

### Task 1: Add the read-only note section to `RepoCard`

**Files:**

- Modify: `app/components/RepoCard.tsx:3-184`
- Reference: `docs/superpowers/specs/2026-08-12-repo-card-note-display-design.md`

**Interfaces:**

- Consumes: existing `RepoCardData.note: string | null` and Ant Design `theme.useToken()`.
- Produces: no new exported interface; `RepoCard` conditionally renders the current note after `TagSelect`.

- [ ] **Step 1: Run the existing focused checks to establish a clean baseline**

Run:

```bash
npx eslint app/components/RepoCard.tsx
npm test
```

Expected: both commands exit with status `0`. The Vitest suite currently covers pure utility modules rather than client component layout, so visual behavior will be checked after implementation.

- [ ] **Step 2: Import the existing icon and Ant Design theme hook**

Update the existing imports in `app/components/RepoCard.tsx`:

```tsx
import { Button, Card, Space, Tag as AntTag, Typography, theme } from "antd"
import {
  FileTextOutlined,
  ForkOutlined,
  HeartFilled,
  HeartOutlined,
  LockOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons"
```

- [ ] **Step 3: Resolve theme tokens inside `RepoCard`**

Add the token lookup before returning JSX:

```tsx
const { token } = theme.useToken()
```

Keep `RepoCard` as its existing Client Component; do not add another component or state layer.

- [ ] **Step 4: Render the distinct two-line note area after `TagSelect`**

Insert this block immediately after the existing `TagSelect`:

```tsx
{repo.note && (
  <div
    style={{
      width: "100%",
      padding: `${token.paddingXXS}px ${token.paddingXS}px`,
      borderRadius: token.borderRadiusSM,
      background: token.colorFillTertiary,
    }}
  >
    <Paragraph
      type="secondary"
      ellipsis={{ rows: 2, tooltip: repo.note }}
      style={{ marginBottom: 0 }}
    >
      <FileTextOutlined style={{ marginRight: token.marginXS }} />
      {repo.note}
    </Paragraph>
  </div>
)}
```

Ant Design owns the overflow detection: the tooltip is associated with ellipsized content and the full note remains the tooltip value.

- [ ] **Step 5: Run focused static verification**

Run:

```bash
npx prettier --check app/components/RepoCard.tsx
npx eslint app/components/RepoCard.tsx
npx tsc --noEmit
git diff --check
```

Expected: every command exits with status `0`, with no TypeScript error for the selected Ant Design tokens or `ellipsis` configuration.

- [ ] **Step 6: Run regression verification**

Run:

```bash
npm test
npm run build
```

Expected: the existing Vitest suite passes and Next.js produces a successful production build.

- [ ] **Step 7: Verify the interaction in the browser**

Run `npm run dev`, then check both `/repos` and `/stars` using data with no note, a short note, and a note longer than two lines:

- no note: no extra container is rendered;
- short note: the full content appears in the distinct note container without an ellipsis;
- long note: the content is clamped to two lines and hovering shows the complete note;
- light and dark themes: the note container remains distinct and readable;
- edit, change, and clear: the card refreshes to show the latest saved note state.

- [ ] **Step 8: Review the final diff and create a scoped implementation commit**

Run:

```bash
git status --short
git diff -- app/components/RepoCard.tsx
git diff --check
git add app/components/RepoCard.tsx
git diff --cached --check
git diff --cached -- app/components/RepoCard.tsx
git commit -m "feat(ui): show notes on repo cards"
```

Expected: the implementation commit contains only `app/components/RepoCard.tsx`; `env.prd` and `mise.toml` remain untracked and untouched.
