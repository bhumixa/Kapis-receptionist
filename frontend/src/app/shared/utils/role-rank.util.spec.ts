import { RoleName } from '../models/user.model';
import { satisfiesRoleRequirement } from './role-rank.util';

describe('satisfiesRoleRequirement', () => {
  it('allows every role to satisfy an empty requirement list', () => {
    expect(satisfiesRoleRequirement([], [])).toBe(true);
    expect(satisfiesRoleRequirement(['STAFF'], [])).toBe(true);
  });

  const cases: [RoleName[], RoleName[], boolean][] = [
    [['STAFF'], ['MANAGER'], false],
    [['MANAGER'], ['MANAGER'], true],
    [['OWNER'], ['MANAGER'], true],
    [['SUPER_ADMIN'], ['MANAGER'], true],
    [['STAFF'], ['OWNER'], false],
    [['MANAGER'], ['OWNER'], false],
    [['OWNER'], ['OWNER'], true],
    [['SUPER_ADMIN'], ['OWNER'], true],
    [['STAFF'], ['STAFF'], true],
    [['STAFF', 'MANAGER'], ['MANAGER'], true],
  ];

  for (const [userRoles, requiredRoles, expected] of cases) {
    it(`userRoles=${JSON.stringify(userRoles)} requiredRoles=${JSON.stringify(requiredRoles)} -> ${expected}`, () => {
      expect(satisfiesRoleRequirement(userRoles, requiredRoles)).toBe(expected);
    });
  }
});
