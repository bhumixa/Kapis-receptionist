import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoleName } from '@prisma/client';
import { ROLE_PERMISSIONS_CACHE_KEY_PREFIX } from '../common/constants/rbac.constants';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';

/**
 * Resolves a user's effective permission set from their role(s)
 * (docs/adr/ADR-005-rbac.md). `User.roles` is a many-to-many via `UserRole`,
 * so a user can hold more than one role — the effective set is the
 * **union** of every held role's permissions, not a single role's set.
 *
 * Deliberately has no `SUPER_ADMIN` special case: the bypass lives
 * exclusively in `SuperAdminBypassService`/the guards that use it, so
 * there's exactly one place that grants and logs it. This service stays a
 * pure, boring "roles -> permission keys" lookup (its answer for
 * `SUPER_ADMIN` happens to already be "everything," since `prisma/seed.ts`
 * assigns it every permission key — but that's incidental, not the
 * mechanism other code should rely on).
 */
@Injectable()
export class PermissionResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async getPermissionKeysForRole(role: RoleName): Promise<Set<string>> {
    const cacheKey = `${ROLE_PERMISSIONS_CACHE_KEY_PREFIX}${role}`;
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      return new Set(JSON.parse(cached) as string[]);
    }

    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { role: { name: role } },
      select: { permission: { select: { key: true } } },
    });
    const keys = rolePermissions.map((rp) => rp.permission.key);

    const ttlSeconds = this.configService.getOrThrow<number>(
      'rbac.permissionCacheTtlSeconds',
    );
    await this.redis.set(cacheKey, JSON.stringify(keys), 'EX', ttlSeconds);

    return new Set(keys);
  }

  async getEffectivePermissions(roles: RoleName[]): Promise<Set<string>> {
    const perRole = await Promise.all(
      roles.map((role) => this.getPermissionKeysForRole(role)),
    );
    const effective = new Set<string>();
    for (const keys of perRole) {
      for (const key of keys) {
        effective.add(key);
      }
    }
    return effective;
  }

  async hasPermission(
    roles: RoleName[],
    permissionKey: string,
  ): Promise<boolean> {
    const effective = await this.getEffectivePermissions(roles);
    return effective.has(permissionKey);
  }
}
