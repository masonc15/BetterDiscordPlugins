# MoveServerToTop Testing Guide

This plugin is tested in layered red/green TDD:

1. Unit and integration tests in this repo (fast, deterministic).
2. In-client smoke and regression checks in Discord desktop with BetterDiscord (closest to real behavior).

## 1) Automated Red/Green TDD

Run:

```bash
npm test
```

Current suite covers:

- Context menu injection shape and placement.
- Duplicate-injection prevention on rerender.
- Wrapped context-menu tree compatibility.
- Move algorithm outcomes: moved, noop, and error.
- Move signature fallback handling.
- Dependency resolution from multiple Webpack/store patterns.
- Plugin lifecycle correctness:
  - patch on `start()`
  - unpatch on `stop()`
  - no patch leak when `start()` is called repeatedly
- User feedback toasts for success/noop/error.

When adding features, follow strict red/green:

1. Add a failing test first.
2. Implement minimal code to pass.
3. Refactor without changing behavior.
4. Re-run full suite.

## 2) In-Client Smoke Tests (Discord + BetterDiscord)

Use a test account and test servers where possible.

### Setup

1. Open BetterDiscord plugin folder.
2. Place `MoveServerToTop.plugin.js` in plugins folder.
3. Enable plugin.
4. Enable BetterDiscord DevTools option and open DevTools.
5. Clear DevTools console.

### Core Behavior

1. Right-click a server in the middle of the list.
2. Confirm `Move Server to Top` appears near top of menu (after `Mark As Read` when available).
3. Click action.
4. Confirm server icon moves to top of server list.
5. Confirm success toast appears.

### Edge Cases

1. Right-click server that is already top:
   - click action
   - confirm no movement
   - confirm info/noop toast
2. Right-click server near very bottom:
   - click action
   - confirm instant move to top (no drag scrolling needed)
3. Right-click server inside folder:
   - click action
   - confirm server ends up at absolute top of overall guild list
4. Open and close context menu repeatedly on same server:
   - confirm item appears exactly once (no duplicates)

### Lifecycle / Cleanup

1. Disable plugin while Discord is running.
2. Right-click server:
   - confirm `Move Server to Top` item is gone.
3. Re-enable plugin:
   - confirm item returns and still works.
4. Use BetterDiscord plugin reload (or disable/enable quickly):
   - confirm no duplicate behavior and no console errors.
5. Restart Discord client:
   - confirm plugin still loads and works.

### Compatibility Checks

1. Enable at least one other plugin that patches guild context menu.
2. Confirm both plugins’ menu items appear without breaking each other.
3. Verify move action still executes and toasts still appear.

### Failure Observation

If move action fails after a Discord update:

1. Click action once.
2. Capture console errors/warnings.
3. Confirm error toast appears instead of silent failure.
4. Record server state before/after click and share logs for update.

## 3) Release Gate

Before release, all conditions must pass:

- `npm test` passes.
- Core behavior + edge-case smoke tests pass.
- Lifecycle cleanup checks pass.
- No new DevTools errors introduced by plugin actions.
