import { RoleName } from '@prisma/client';
import { PermissionResolverService } from '../../../src/core/permission-resolver.service';
import { PrismaService } from '../../../src/database/prisma.service';
import { RedisService } from '../../../src/database/redis.service';

const CONFIG: Record<string, number> = {
  'rbac.permissionCacheTtlSeconds': 3600,
};

interface PrismaOverrides {
  rolePermission?: { findMany: jest.Mock };
}

function buildService(
  prismaOverrides: PrismaOverrides = {},
  redisOverrides: Partial<Record<string, jest.Mock>> = {},
) {
  const prisma = {
    rolePermission: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...prismaOverrides,
  };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    ...redisOverrides,
  };
  const configService = {
    getOrThrow: (key: string) => CONFIG[key],
  };

  const service = new PermissionResolverService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    configService as unknown as ConstructorParameters<
      typeof PermissionResolverService
    >[2],
  );
  return { service, prisma, redis };
}

describe('PermissionResolverService', () => {
  describe('getPermissionKeysForRole', () => {
    it('queries Prisma and caches the result on a cache miss', async () => {
      const { service, prisma, redis } = buildService({
        rolePermission: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { permission: { key: 'staff:invite' } },
              { permission: { key: 'tenant:manage' } },
            ]),
        },
      });

      const keys = await service.getPermissionKeysForRole(RoleName.MANAGER);

      expect(prisma.rolePermission.findMany).toHaveBeenCalledWith({
        where: { role: { name: RoleName.MANAGER } },
        select: { permission: { select: { key: true } } },
      });
      expect(keys).toEqual(new Set(['staff:invite', 'tenant:manage']));
      expect(redis.set).toHaveBeenCalledWith(
        'rbac:role-permissions:MANAGER',
        JSON.stringify(['staff:invite', 'tenant:manage']),
        'EX',
        3600,
      );
    });

    it('returns the cached result without querying Prisma on a cache hit', async () => {
      const { service, prisma, redis } = buildService(
        {},
        { get: jest.fn().mockResolvedValue(JSON.stringify(['staff:invite'])) },
      );

      const keys = await service.getPermissionKeysForRole(RoleName.MANAGER);

      expect(redis.get).toHaveBeenCalledWith('rbac:role-permissions:MANAGER');
      expect(prisma.rolePermission.findMany).not.toHaveBeenCalled();
      expect(keys).toEqual(new Set(['staff:invite']));
    });
  });

  describe('getEffectivePermissions', () => {
    it('unions permissions across every held role', async () => {
      const { service } = buildService({
        rolePermission: {
          findMany: jest
            .fn()
            .mockImplementation(
              ({ where }: { where: { role: { name: RoleName } } }) => {
                if (where.role.name === RoleName.MANAGER) {
                  return Promise.resolve([
                    { permission: { key: 'staff:invite' } },
                  ]);
                }
                return Promise.resolve([]);
              },
            ),
        },
      });

      const effective = await service.getEffectivePermissions([
        RoleName.MANAGER,
        RoleName.STAFF,
      ]);

      expect(effective).toEqual(new Set(['staff:invite']));
    });
  });

  describe('hasPermission', () => {
    it('returns true when the effective set contains the key', async () => {
      const { service } = buildService({
        rolePermission: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ permission: { key: 'billing:manage' } }]),
        },
      });

      await expect(
        service.hasPermission([RoleName.OWNER], 'billing:manage'),
      ).resolves.toBe(true);
    });

    it('returns false when the effective set does not contain the key', async () => {
      const { service } = buildService({
        rolePermission: { findMany: jest.fn().mockResolvedValue([]) },
      });

      await expect(
        service.hasPermission([RoleName.STAFF], 'billing:manage'),
      ).resolves.toBe(false);
    });
  });
});
