# Notification bell

The shared application header displays stored workflow notifications for the signed-in user. It refreshes every 30 seconds while the page is visible, when the window regains focus, when the bell opens, and after successful actions in the application.

- The numbered badge is the unread notification count across all unresolved notifications, independent of the list limit. The dropdown shows up to 100 entries, with unread entries first.
- Pending task summaries appear separately. A dot remains when tasks are pending but notifications have been read; reading a notification does not complete a financial action.
- Existing active, pending employee and supplier bank profiles appear in Accounting and Admin task summaries, including profiles created before this change.
- New and replacement employee reimbursement bank profiles create individual notifications for active Accounting and Admin users. Repeated delivery of the same review event does not create duplicates.
- A review resolves the pending reviewer alert and notifies the profile owner of the decision. Replacing or deactivating a profile resolves its old review alert.
- Employee bank notification links select the relevant profile. Review comments are retained on the profile; account numbers and CCI are excluded from notification text.
- A task-summary failure does not clear the notification list. Failed read operations show an error and do not falsely mark notifications read.

This change connects the existing workflow notification feed and bank review events to the bell. It does not complete the separate platform-wide task assignment, escalation and ownership-tooltip work.

Validation: backend notification lifecycle test, frontend contract suite, isolated desktop/mobile browser test and production frontend build passed. The complete backend suite reports 149 passing and 14 failing tests. The same 14 request-rule, workflow-graph and financial-lifecycle failures were reproduced using an isolated copy of HEAD before these changes.

Commands:

```text
cd backend
node test/notificationBell.test.js
cd ../frontend
npm test
npm run test:notification-bell-ui
npm run build
```
