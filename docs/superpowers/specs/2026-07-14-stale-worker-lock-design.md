# Stale Worker Lock Design

## Goal

Prevent a terminated worker process from blocking the next GUI start for up to one hour.

## Design

The lock file remains the single-worker guard and continues to store the worker PID and start time. A lock is active only when its PID is still alive and its age is within the stale timeout. PID liveness uses Node's cross-platform `process.kill(pid, 0)` check; `EPERM` means the process exists but cannot be signalled.

Both lock acquisition and Dashboard status use the same lock-state function. A dead or malformed lock is treated as stale, while a live PID remains protected. No dependency or platform-specific command is added.

## Verification

- A fresh lock with a dead PID is reported inactive and replaced immediately.
- A fresh lock with a live PID remains active.
- Existing timeout-based stale-lock behavior remains unchanged.
- Full Node, React, Rust, format, and Tauri release checks pass before publishing.
