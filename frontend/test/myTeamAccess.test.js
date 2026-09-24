import assert from 'node:assert/strict';
import {authenticatedRoles, canAccessNavigation, navigationForUser, visibleNavigationPaths} from '../src/utils/navigationAccess.js';
for (const role of authenticatedRoles) {
  for (const hasTeam of [undefined,false,true]) {
    const user={role,hasTeam};
    assert.equal(canAccessNavigation(role,'/my-team',user),hasTeam===true);
    assert.equal(navigationForUser(user).some(([,path])=>path==='/my-team'),hasTeam===true);
    assert.equal(visibleNavigationPaths(role,user).includes('/my-team'),hasTeam===true);
  }
}
console.log('PASS My Team navigation requires server-confirmed membership across all roles.');
