// The browser side of the role and permission catalog (shared/accessControl.mjs). It only decides
// what to show: the API checks every call again, so a hidden button is never the control.
import { can, hasRole as catalogHasRole, PERMISSIONS, primaryRole, ROLE_CODES, ROLE_LABELS, ROLES, rolesOf } from "../../../shared/accessControl.mjs";

export { PERMISSIONS, primaryRole, ROLE_CODES, ROLE_LABELS, ROLES, rolesOf };

// The session carries the permissions the server computed (sessionUser); without them (tests,
// an older session) the same catalog computes them from the person's roles and grants.
export function userCan(user, ...permissions) {
  const effective = user?.effectivePermissions;
  return permissions.flat().some((permission) => Array.isArray(effective) ? effective.includes(permission) : can(user, permission));
}

export function hasRole(user, ...roles) {
  return catalogHasRole(user, ...roles);
}

// "SOL · JEF": the codes of every role a person holds.
export function roleCodes(user) {
  return rolesOf(user).map((role) => ROLE_CODES[role]).join(" · ");
}
