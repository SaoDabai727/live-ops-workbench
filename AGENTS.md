# AGENTS.md

## Agent skills

### Issue tracker

Issues live as local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default roles: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

single-context (root `CONTEXT.md` + `docs/adr/`). See `docs/agents/domain.md`.

## Shipping / in-app updates

User-facing fixes must finish as a GitHub Release (version bump + build + tag + assets), not only a `main` commit. See `.cursor/rules/ship-release.mdc`.
