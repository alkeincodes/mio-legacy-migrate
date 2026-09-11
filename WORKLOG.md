# Worklog

## 2026-09-12: M1 plan executed, 26 of 26 tasks

All tasks in `docs/superpowers/plans/2026-09-12-legacy-hub-migration-m1.md` are
coded and committed. Suite: 341 tests, typecheck clean.

Verified for real:
- `extract --check-access` against the production replica through the SSH
  tunnel. The tunnel works. The replica refused the login for the user in
  `.env`, so the read-replica credentials still need sorting out.
- `map` against the live catalog 0.23.6 on a synthetic bundle built from the
  test fixtures: zero `dropped`, no catalog validation warnings.
- `apply --dry-run` on that plan: contracts gate, catalog digest check and the
  16-operation render all pass. Nothing mutated.

Not yet run (need `.env` values): the real bundle capture, map of the real
bundle, `apply --dry-run` on it, `apply --check-access`, any real apply, and
`verify`. Also outstanding: posting the section mapping table to Mihai for
review (Task 10 step 7), and creating the two authorization test members.

Deviations from the plan worth knowing:
- The plan's orchestrator only carried the hub and asset stages. The other ten
  are in `src/apply/stages.ts`, written against mio-backend's real routes.
- Segments are not created in M1: V3 needs a typed condition tree and no
  legacy mapping exists. Dependent access rules are skipped and their pages
  stay unpublished. See `docs/contracts.md`.
- Navigation url items must be root-relative on V3; off-site links are
  dropped with a run warning in `runs/<runId>/apply-warnings.json`.
- Favicon conversions force png; every other searchie conversion keeps the
  original extension.
- The plan carries `legacyHubDomain`, so nothing hardcodes the pilot origin.
