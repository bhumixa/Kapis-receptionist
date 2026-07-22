import { RoleName } from '@prisma/client';
import { satisfiesRoleRequirement } from '../../../src/common/constants/rbac.constants';

describe('satisfiesRoleRequirement', () => {
  it('allows every role to satisfy an empty requirement list', () => {
    expect(satisfiesRoleRequirement([], [])).toBe(true);
    expect(satisfiesRoleRequirement([RoleName.STAFF], [])).toBe(true);
  });

  const cases: Array<[RoleName[], RoleName[], boolean]> = [
    [[RoleName.STAFF], [RoleName.MANAGER], false],
    [[RoleName.MANAGER], [RoleName.MANAGER], true],
    [[RoleName.OWNER], [RoleName.MANAGER], true],
    [[RoleName.SUPER_ADMIN], [RoleName.MANAGER], true],
    [[RoleName.STAFF], [RoleName.OWNER], false],
    [[RoleName.MANAGER], [RoleName.OWNER], false],
    [[RoleName.OWNER], [RoleName.OWNER], true],
    [[RoleName.SUPER_ADMIN], [RoleName.OWNER], true],
    [[RoleName.STAFF], [RoleName.STAFF], true],
    [[RoleName.STAFF, RoleName.MANAGER], [RoleName.MANAGER], true],
  ];

  it.each(cases)(
    'userRoles=%j requiredRoles=%j -> %s',
    (userRoles, requiredRoles, expected) => {
      expect(satisfiesRoleRequirement(userRoles, requiredRoles)).toBe(expected);
    },
  );
});
