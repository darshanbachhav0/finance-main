import assert from 'node:assert/strict';
import {authenticatedRoles, canAccessNavigation, navigationForUser, visibleNavigationPaths} from '../src/utils/navigationAccess.js';
for (const role of authenticatedRoles) {
  for (const hasTeam of [undefined,false,true]) {
    const user={role,hasTeam};
    // The read-only Auditor is outside the hierarchy (never a supervisor), so it never gets My Team.
    const expected=hasTeam===true&&role!=='Auditor';
    assert.equal(canAccessNavigation(role,'/my-team',user),expected);
    assert.equal(navigationForUser(user).some(([,path])=>path==='/my-team'),expected);
    assert.equal(visibleNavigationPaths(role,user).includes('/my-team'),expected);
  }
}
console.log('PASS My Team navigation requires server-confirmed membership across all roles.');

// Approvals in a Solicitor's menu only when they actually approve: someone reports to them, an
// approval step is assigned to them, or the live counter shows one. Roles that approve keep it.
const hasApprovals = (user, options) => navigationForUser(user, options).some(([, path]) => path === '/approvals');
assert.equal(hasApprovals({ role: 'Solicitor' }), false, 'a Solicitor with no team and nothing assigned sees no Approvals');
assert.equal(hasApprovals({ role: 'Solicitor', hasTeam: false, hasPendingApprovals: false }), false);
assert.equal(hasApprovals({ role: 'Solicitor', hasTeam: true }), true, 'a Solicitor who is someone\'s jefe approves their requests');
assert.equal(hasApprovals({ role: 'Solicitor', hasPendingApprovals: true }), true, 'an assigned approval (e.g. covering a jefe on leave)');
assert.equal(hasApprovals({ role: 'Solicitor' }, { pendingApprovals: 2 }), true, 'an approval assigned mid-session appears');
for (const role of ['AreaDirector', 'ViceRector', 'Management', 'GAF']) assert.equal(hasApprovals({ role }), true, `${role} keeps Approvals`);
// Legal and Human Resources hold no approval authority by role: Approvals only as someone's jefe.
for (const role of ['Legal', 'HumanResources']) {
  assert.equal(hasApprovals({ role }), false, `${role} with no team sees no Approvals`);
  assert.equal(hasApprovals({ role, hasTeam: true }), true, `${role} who is someone's jefe approves`);
}
assert.equal(hasApprovals({ role: 'Auditor', hasTeam: true }), false, 'the read-only Auditor never approves');
// The administrator is not an approver either, unless a step is assigned to them.
assert.equal(hasApprovals({ role: 'Admin' }), false, 'Admin has no approval authority');
// The retired ManagementViewer reads as the Auditor.
assert.equal(canAccessNavigation('ManagementViewer', '/my-team', { role: 'ManagementViewer', hasTeam: true }), false);
// The page itself stays reachable for notification links.
assert.equal(canAccessNavigation('Solicitor', '/approvals', { role: 'Solicitor' }), true);
console.log('PASS Approvals appears in a Solicitor\'s menu only when they approve requests.');
