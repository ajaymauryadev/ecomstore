# ECOMSTORE working rules

These rules apply to work in this repository. Use `ECOMSTORE_PRODUCTION_OPTIMIZATION_MASTER_PLAN.md` and `ECOMSTORE_ROUTE_ROLE_REGRESSION_PERFORMANCE_MATRIX.md` as implementation references. Preserve any other valid repository instructions.

1. Implement only the phase the user has requested. Deliver working code for that phase, not recommendations alone. Stop after each phase and obtain user approval before starting another.
2. Preserve existing features, UI design, workflows, API contracts, permissions, offline capabilities, and financial and stock correctness. Treat server authorization and tenant isolation as required, including when client behavior changes.
3. Inspect callers, routes, data flows, tests, and other dependencies before changing or deleting code. Prove a path is unused before removing it.
4. Prefer the simplest architecture that meets the measured need. Avoid speculative optimizations and unnecessary dependencies.
5. Measure performance before and after under comparable fixture, cache, device, network, browser, build, and server conditions. Record raw samples, sample count, p50/p95 where relevant, and correctness checks. Do not claim an improvement from unmatched runs.
6. Create a safe Git checkpoint before each phase's changes and record its reference. Preserve unrelated user changes; do not reset, clean, overwrite, or include them in a phase commit without authorization.
7. After every implementation phase, run frontend and backend tests, a production frontend build, and the affected browser regression cases from the route and role matrix. Add missing regression tests for changed behavior. Never weaken tests to make them pass.
8. Fix regressions before proceeding. Mark a required test that cannot run as **BLOCKED**, with its reason and the remaining risk; never mark it **PASS**.
9. Do not change production data, deploy automatically, or use destructive Git commands.
10. Maintain `ECOMSTORE_IMPLEMENTATION_PROGRESS.md` after each phase with status, changed files, before/after measurements, test and browser case results, blockers, decision, and rollback reference. Do not mark a phase complete until its required evidence and gates are satisfied.
