# 0007 — Isolated apps + shared platform repository

- **Status:** accepted
- **Date:** 2026-10-21
- **Canonical:** [`7oas7er/platform` ADR 0001](https://github.com/7oas7er/platform/blob/main/docs/adr/0001-shared-edge-and-obs.md)

## Context

Sibling apps on zone `7oas7er.com` and one Grafana Cloud Free stack cannot each own zone rulesets (one per phase) or the same Infinity / GitHub plugin objects. Putting those in DressMe made Netrunner implicitly depend on this repo — wrong dependency direction for humans and agents.

## Decision

1. **Apps stay isolated repositories** (product + AWS site + DNS + app Grafana).
2. Shared zone policy and shared Grafana stack objects live in [`7oas7er/platform`](https://github.com/7oas7er/platform) (`shared-edge`, `shared-obs`).
3. This app’s Cloudflare root is **DNS only**; Grafana root does not create Infinity or install the GitHub plugin.
4. Dependency graph is **app → platform**, never Netrunner → DressMe (or any app → app).

## Consequences

- Origin-verify / cache / rate-limit / SSL changes: edit and apply **platform** `shared-edge`.
- Infinity / GitHub plugin: **platform** `shared-obs`.
- Cloning a new app from this template must include platform wiring (see skill `new-app-from-template` and [architecture.md](../architecture.md)).
- Cursor `app-*` rules document the split; product overlays stay thin.
