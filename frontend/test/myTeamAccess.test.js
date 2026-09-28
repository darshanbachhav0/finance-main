import assert from 'node:assert/strict';
import {authenticatedRoles, canAccessNavigation, navigationForUser, visibleNavigationPaths} from '../src/utils/navigationAccess.js';
for (const role of authenticatedRoles) {
  for (const hasTeam of [undefined,false,true]) {
    const user={role,hasTeam};
    // ManagementViewer is portal-only (and can never be a supervisor), so it never gets My Team.
    const expected=hasTeam===true&&role!=='ManagementViewer';
    assert.equal(canAccessNavigation(role,'/my-team',user),expected);
    assert.equal(navigationForUser(user).some(([,path])=>path==='/my-team'),expected);
    assert.equal(visibleNavigationPaths(role,user).includes('/my-team'),expected);
  }
}
console.log('PASS My Team navigation requires server-confirmed membership across all roles.');
