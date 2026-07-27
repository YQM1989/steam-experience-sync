# Newest-First Feed Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make continuous sync poll the newest public screenshot feed without walking past empty pages, while keeping historical backfill explicit and removing the stale Queue UI.

**Architecture:** Continuous feed mode always starts from page 1 and uses the existing seen screenshot IDs as its incremental boundary. Screenshot pagination stops on the first empty page for every scan mode. Historical scanning remains available through explicit CLI commands, while the GUI only exposes the current feed workflow.

**Tech Stack:** Node.js ESM, React, TypeScript, Vitest, Tauri 2, Rust

## Global Constraints

- Keep the existing single-worker lock and anti-429 delay floors unchanged.
- Do not make real Steam requests during implementation verification.
- Preserve the legacy discovery and appid CLI code as a compatibility fallback.
- Do not commit `CLAUDE.md` or any secret-bearing local configuration.

---

### Task 1: Stop pagination at empty pages

**Files:**
- Modify: `src/index.mjs`
- Test: `tests/core/screenshot-pages.test.mjs`

**Interfaces:**
- Produces: `collectScreenshotIdPages(config, fetchPage?)` yielding only non-empty page results and stopping at the first empty page.

- [x] **Step 1: Write a failing test that returns one populated page followed by an empty page.**
- [x] **Step 2: Run the focused test and confirm it fails because the iterator continues past the empty page.**
- [x] **Step 3: Make the iterator stop on an empty page regardless of `pages` mode.**
- [x] **Step 4: Run the focused test and confirm it passes.**

### Task 2: Make continuous feed polling newest-first

**Files:**
- Modify: `src/index.mjs`
- Modify: `src/core/worker-progress.mjs`
- Test: `tests/core/worker-progress.test.mjs`

**Interfaces:**
- Produces: feed worker state whose effective `nextPage` is always `1`.
- Preserves: appid worker cursor behavior for compatibility.

- [x] **Step 1: Add failing worker-progress tests for newest-first feed state and legacy cursor migration.**
- [x] **Step 2: Run the focused tests and confirm the current advancing cursor fails them.**
- [x] **Step 3: Add a dedicated newest-feed state helper and use it in `runFeedWorker`.**
- [x] **Step 4: Force feed mode to scan only the newest page per round and reset old page cursors to page 1.**
- [x] **Step 5: Run the focused tests and confirm they pass.**

### Task 3: Remove the stale Queue UI

**Files:**
- Modify: `src-ui/App.tsx`
- Modify: `src-ui/App.test.tsx`
- Delete: `src-ui/Queue.tsx`
- Delete: `src-ui/Queue.test.tsx`

**Interfaces:**
- Preserves: Node discovery store and CLI fallback.
- Removes: Queue tab and its React rendering path.

- [x] **Step 1: Update the App test to expect no Queue navigation item and run it against the current UI.**
- [x] **Step 2: Confirm the test fails because Queue is still rendered.**
- [x] **Step 3: Remove Queue from the tab type, navigation list, import, and render path.**
- [x] **Step 4: Delete the unused Queue component tests and component.**
- [x] **Step 5: Run UI tests and confirm they pass.**

### Task 4: Document and verify the workflow

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents: continuous newest-first sync and explicit historical backfill.

- [x] **Step 1: Update README workflow descriptions without exposing local paths or secrets.**
- [x] **Step 2: Run `npm test`.**
- [x] **Step 3: Run `npm run test:ui`.**
- [x] **Step 4: Run `npm run check`.**
- [x] **Step 5: Run `cargo test` and `cargo fmt --check` from `src-tauri`.**
- [x] **Step 6: Inspect `git diff` and verify only intended files changed.**
