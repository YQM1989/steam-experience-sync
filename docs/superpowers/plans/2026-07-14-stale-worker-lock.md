# Stale Worker Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make worker locks recover immediately when the recorded process no longer exists.

**Architecture:** Keep PID liveness in `worker-lock.mjs` and expose one asynchronous lock-state function reused by acquisition and status output. Inject the liveness check in tests so no real process is signalled.

**Tech Stack:** Node.js ESM, `node:test`, React/Tauri status bridge.

## Global Constraints

- Do not delete a lock owned by a live process.
- Do not add dependencies or platform-specific shell commands.
- Preserve the existing one-hour timeout fallback.

---

### Task 1: Recover dead-process locks

**Files:**
- Modify: `src/core/worker-lock.mjs`
- Modify: `src/index.mjs`
- Test: `tests/core/worker-lock.test.mjs`

**Interfaces:**
- Produces: `isWorkerLockActive(lockFile, options): Promise<boolean>`
- Consumes: lock JSON containing `pid` and `startedAt`

- [ ] **Step 1: Write the failing tests**

Add tests proving a fresh dead-PID lock is inactive and immediately replaceable.

- [ ] **Step 2: Verify the tests fail**

Run: `node --test tests/core/worker-lock.test.mjs`

Expected: FAIL because PID liveness is not checked.

- [ ] **Step 3: Implement the minimal lock-state function**

Use `process.kill(pid, 0)` by default and an injected `isProcessAlive` function in tests. Reuse it in acquisition and worker status output.

- [ ] **Step 4: Verify focused and full checks**

Run the focused Node test, full Node/UI/Rust suites, formatting, status JSON, and Tauri release build.

- [ ] **Step 5: Publish the reviewed scope**

Stage project changes explicitly while excluding `CLAUDE.md`, review the staged diff, commit, and push `main` to `origin`.
