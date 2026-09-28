# Hierarchy approval policy

Product decision: every assigned jefe can finalize approval or forward to their own available jefe. This applies to A1, A2, B and C and supersedes mandatory role-based tails for new hierarchy routes. Identity through User.jefe grants only the assigned approval action, not financial-module permissions. Users without a jefe must receive an explicit supervisor assignment before submitting; generic/demo fallback is disabled. Existing purely rule-based historical routes remain readable and are not silently rewritten.

Finalization completes request approval. Existing budget, document, accounting-period, fiscal, payment and reconciliation controls still run. The normal automatic budget handoff is retained; if it cannot complete, the existing Budget review/exception handling applies. Forwarding is unavailable without a higher available supervisor. Existing cycle and self-approval guards remain.

## Deployment and existing requests

1. Deploy backend and frontend together. The request detail now names the pending approver, and both approval screens explain finalization versus forwarding.
2. In the backend directory, with the intended MONGODB_URI configured, run `node scripts/migrateHierarchyFinalization.js` (read-only default).
3. Review the report, retain a database backup, and pause approval writes during application. Run `node scripts/migrateHierarchyFinalization.js --apply` only after deploying. Atlas/a MongoDB replica set is required for transactions. There is deliberately no standalone non-transactional fallback.
4. The migration only completes pending mixed hierarchy/role routes with matching actor, stage and timestamp evidence of a jefe's final decision. It leaves uncertain decisions for review. It does not add a human signature, reserve funds, post accounting, or mark a payment.
5. Request update, appended audit/history, stale approval-notification resolution, and the Budget bell notification share one transaction. Concurrent request edits abort the change. Repeating the migration does not change already-migrated requests.
6. Budget users review migrated approved requests through their normal budget controls. Do not use a demo approver to complete them.

Read-only live review found SOL-2026-00011, SOL-2026-00012 and SOL-2026-00013 eligible. SOL-2026-00009 still requires its manager's real decision. Re-run the dry run because this may change before deployment.

Original routes are retained in the appended audit record. Completed sign-offs are untouched. If correction is necessary after migration, use a reviewed compensating operation with an audit record; never remove the migration audit or reverse financial records automatically.

Validation: full backend suite passed (411 tests before the additional all-track route case); the additional manager-chain suite passed 12 tests, migration planner/dry-run suite passed 3. Frontend test command and production build passed. The build reports an existing duplicate PARTIALLY_PAID key in StatusBadge. Migration apply has not been run against the live database; transaction application needs verification on staging before live use.
