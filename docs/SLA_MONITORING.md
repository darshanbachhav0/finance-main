# Approval SLA monitoring and audit

Run `npm run worker:sla --workspace backend` as a continuously supervised process alongside the API (systemd, PM2, or a separate container). Use the same backend environment and MONGODB_URI. From the backend directory, `npm run worker:sla` is equivalent. Enable restart-on-failure in the deployment process supervisor. The web/API process does not start this worker. For a deployment smoke check use `npm run sla:check --workspace backend`.

Configuration (defaults):

| Environment variable | Default | Meaning |
| --- | --- | --- |
| SLA_DUE_SOON_HOURS | 4 | Hours before the existing deadline to alert current approvers |
| SLA_ESCALATION_HOURS | 24 | Hours after deadline to alert approvers and active Management users |
| SLA_POLL_MS | 60000 | Delay between completed scans; minimum 1000 ms |

Overdue begins immediately after the saved deadline. Configure these variables consistently on API and worker so displayed classifications match notifications. Monitoring never changes approval deadlines or historical route snapshots. Route role, level, area and ownership determine recipients; Admin is not notified simply because it can act as an administrator. Management escalation grants no additional approval authority.

Alerts go to the existing notification bell. Identity includes request, approval step, deadline/start time, severity and recipient. Retries and concurrent scans do not duplicate alerts or reset read state. A later severity resolves earlier alerts. Finished/stopped approvals resolve alerts on the next scan. The worker retries failed scans; a stopped worker catches up at the current severity after restart, without sending obsolete due-soon alerts.

Escalations create an immutable SYSTEM audit with deadline, stage, recipients and unchanged request status. New audits expose statusFrom/statusTo; old audit data is not backfilled or modified. Posting and BBVA file events include request references even when the parent status does not change. Normal model replacement, document deletion and bulk mutation of audit history are blocked. Direct database administrator privileges remain outside application enforcement.

No data migration is required. The worker ensures the existing unique notification index and new partial unique audit eventKey index exist before scanning. The partial index does not affect historical audits without eventKey. Grant index creation permissions for deployment, or provision these indexes through your DBA before starting the worker.

The old Admin self-approval override is disabled. No emergency status correction endpoint is added. Payment, reconciliation, terminal-state and closure evidence controls remain enforced.

## Files changed in this update

| File | Change |
| --- | --- |
| backend/src/services/slaPolicy.js | Configurable classification shared by monitor and API |
| backend/src/services/slaMonitoringService.js | Recipient selection, idempotent bell alerts, resolution and escalation audit |
| backend/src/workers/slaWorker.js | Recurring supervised process, index checks and graceful shutdown |
| backend/src/services/approvalRuleService.js | Existing SLA response uses shared thresholds |
| backend/src/controllers/dashboardController.js | Due-soon/escalated counters and approval row severity |
| backend/src/models/AuditLog.js | Additive status fields, unique escalation key, stronger mutation guards |
| backend/src/services/auditService.js | Actor information and previous/new status on new audit records |
| backend/src/services/accountingService.js | Explicit journal posting audits |
| backend/src/services/treasuryService.js | Request-linked audit for each CXP included in a BBVA file |
| backend/src/services/budgetExceptionService.js | Preserve before/after exception decision values |
| backend/src/services/approvalService.js | Disable emergency self-approval override |
| backend/src/services/workflowService.js | Reject override and preserve self-approval prohibition |
| backend/package.json | Worker and one-shot commands |
| backend/.env.example | SLA monitoring configuration defaults |
| backend/test/slaMonitoring.test.js | Monitoring, recipient, retry, resolution, immutability and override regression coverage |
| backend/test/financialLifecycle.test.js | Real transition, posting and BBVA audit checks |
| backend/test/run.js | Register SLA tests |
| frontend/src/pages/ApprovalInbox.jsx | Display backend SLA severity |
| frontend/src/pages/Dashboard.jsx | Display SLA classification and due date for approval rows |
| frontend/src/layouts/AppLayout.jsx | SLA severity colors in the existing bell |
| frontend/src/components/StatusBadge.jsx | SLA badge colors |
| frontend/src/context/LanguageContext.jsx | Spanish SLA labels |
| frontend/test/slaContracts.test.js | Frontend SLA display checks |
| frontend/test/run.js | Register frontend SLA tests |
| docs/SLA_MONITORING.md | Production operation and change inventory |

Validation: backend 236 tests passed; frontend tests passed; frontend production build passed. No production worker was installed or started by this code change.
