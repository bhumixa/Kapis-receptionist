import { User } from '../models/user.model';
import { NavItem, filterNavItemsByAccess } from './nav-filter.util';

function makeUser(roles: User['roles']): User {
  return {
    id: 'user-1',
    email: 'user@salon.com',
    firstName: 'Ana',
    lastName: 'Ruiz',
    roles,
    isActive: true,
    isEmailVerified: true,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

const items: NavItem[] = [
  { label: 'Dashboard', route: '/app/dashboard' },
  { label: 'Staff', route: '/app/staff', roles: ['MANAGER'] },
  { label: 'Billing', route: '/app/billing', permission: 'billing:manage' },
];

describe('filterNavItemsByAccess', () => {
  it('returns an empty list when there is no user', () => {
    expect(filterNavItemsByAccess(items, null, () => true)).toEqual([]);
  });

  it('includes items with no role/permission requirement for any authenticated user', () => {
    const result = filterNavItemsByAccess(items, makeUser(['STAFF']), () => false);
    expect(result.map((i) => i.label)).toEqual(['Dashboard']);
  });

  it('includes a role-gated item for a sufficiently-ranked role', () => {
    const result = filterNavItemsByAccess(items, makeUser(['OWNER']), () => false);
    expect(result.map((i) => i.label)).toEqual(['Dashboard', 'Staff']);
  });

  it('includes a permission-gated item only when permissionCheck returns true', () => {
    const staffOnlyUser = makeUser(['STAFF']);
    const denied = filterNavItemsByAccess(items, staffOnlyUser, () => false);
    expect(denied.map((i) => i.label)).toEqual(['Dashboard']);

    const granted = filterNavItemsByAccess(items, staffOnlyUser, (p) => p === 'billing:manage');
    expect(granted.map((i) => i.label)).toEqual(['Dashboard', 'Billing']);
  });

  it('includes every item for a user satisfying both role and permission checks', () => {
    const result = filterNavItemsByAccess(items, makeUser(['OWNER']), () => true);
    expect(result.map((i) => i.label)).toEqual(['Dashboard', 'Staff', 'Billing']);
  });
});
