# Agent Note: Desktop session-level deep links

Status: implemented

English | [中文](2026-11-24-desktop-session-deep-link.zh.md)

## Problem

External producers such as the Agent HUD want to copy a `dsh://open/?session=<id>` link that opens the same Session from a browser, notes, or another application. Before this change the Desktop entry registered the `dsh:` scheme, but `dsh://open` only focused the window; a link carrying a Session target was ignored. Both a cold-quit macOS launch and an already-running instance needed to navigate to another Workspace's Session, and an invalid or inaccessible target had to keep the current Session with clear feedback instead of navigating nowhere.

## Decision

Only the Session tier ships. Message and turn positioning (`seq`) is deferred to a later tier.

### Parsing in the main process

[`deep-link.ts`](../../../../apps/desktop/src/deep-link.ts) parses one strict target:

- protocol `dsh:`, host `open`, empty or `/` path, a single `session` parameter (a repeated parameter keeps the first value).
- Whitelisted ids: `session-` plus a dashed 36-char UUID or a compact 32 lowercase hex string; `orchestrator-` plus 8–64 lowercase hex characters.
- Anything else resolves to null. A plain `dsh://open` keeps the previous focus-only behavior.

### Entry points

- Cold start: a Windows relaunch carries the link in `process.argv`, scanned at `main()` start; macOS delivers the link through `open-url`.
- Running instance: Windows passes the link through the `second-instance` launch arguments; macOS delivers it through `open-url`.
- A module-level pending target survives until the workspace renderer drains it. If a live window exists, the target is pushed immediately over `deepLinkChanged`; otherwise it waits for the workspace boot.

### Preload bridge

The application preload exposes `dshDesktop.deepLink`: `take()` drains the pending cold-start target and clears it; `subscribe(listener)` returns an unsubscribe function. The IPC channels are `deep-link-take` (invoke) and `deep-link-changed` (event). The take handler keeps the existing product-sender assertion.

### Renderer navigation

[`deep-link.ts`](../../../../packages/client/ui-workspace/src/client/deep-link.ts) installs on the workspace plugin lifetime and is a no-op without the bridge. It drains the cold-start target and subscribes to later links, waits until both the Session and Workspace snapshots are `ready`, then:

- a listed, non-archived Session calls `openSession`;
- an archived Session raises the existing `archivedNotOpenable` notice;
- an unknown or inaccessible Session raises the new `deepLinkUnknown` warning, and the current selection stays.

The latest queued target supersedes earlier ones. Disposal unsubscribes both list sources and the bridge.

## Alternatives considered

**Parse in the renderer.** The main process would forward the raw argv or URL string and the renderer would re-implement scheme, host, and id rules, risking navigation on a malformed link before snapshots settle. The main process owns scheme registration and sender trust, so validation stays there.

**Pass the full SessionTarget through the link.** Subagent addresses are composite objects rather than single id strings; this tier resolves plain Session ids only.

**Open on second-instance without waiting for snapshots.** The workspace list may still be pending, so an early retain or navigation would race startup reconciliation. Draining after both baselines are ready matches the existing startup navigation.

**Treat archived sessions like unknowns.** The existing archived notice already tells the user to unarchive; reusing it keeps one recovery path instead of a second notice copy.

## Consequences

- A valid session link reaches the target Session after the workspace boots, across Workspaces; both the cold-quit and running-instance paths are covered.
- Malformed, unknown, or inaccessible targets never move the current selection; archived sessions get the archived notice.
- The bridge is optional: Web builds and older Desktop preloads install nothing.
- Message and turn positioning remains out of scope; a later tier can extend the parser and renderer together.

## Testing

- [`deep-link.spec.ts`](../../../../apps/desktop/tests/deep-link.spec.ts) covers dashed and compact session ids, the orchestrator id, rejected host/path/parameter/shape/uppercase/non-url forms, and argv scanning with an empty fallback.
- [`single-instance.spec.ts`](../../../../apps/desktop/tests/single-instance.spec.ts) forwards the second-instance argv to the owner and keeps the empty-argv fallback.
- [`deep-link.client.spec.ts`](../../../../packages/client/ui-workspace/tests/deep-link.client.spec.ts) covers the no-bridge no-op, cold-start known/unknown/archived targets, waiting for both startup baselines, running-instance subscription, and supersession by a later queued target.
- The existing main-startup and welcome-startup suites exercise the second-instance and open-url wiring.
