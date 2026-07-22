import { PrismaService } from '../../database/prisma.service';
import { TenantResourceNotFoundException } from '../guards/rbac.exceptions';

/**
 * The minimal Prisma delegate surface every `TenantScopedRepository`
 * subclass must expose (docs/TENANT_ARCHITECTURE.md, docs/adr/ADR-006 —
 * "the repository base class + template every future tenant-owned module's
 * migrations will follow", IMPLEMENTATION_ROADMAP.md Sprint 3.1).
 *
 * Deliberately typed with `any` args/results rather than threading each
 * Prisma model's generated `WhereInput`/`CreateInput`/... types through a
 * shared generic: with only two tenant-owned models existing at this
 * milestone (`TenantSettings`, `TenantInvitation`), the type-gymnastics cost
 * of a fully generic delegate contract outweighs the benefit today. Each
 * subclass's own public methods are fully typed against its own entity —
 * this interface only constrains the *shape* every subclass's underlying
 * Prisma delegate must have, not the call-site API.
 */
export interface TenantScopedDelegate {
  findFirst(args: Record<string, unknown>): Promise<unknown>;
  findUnique(args: Record<string, unknown>): Promise<unknown>;
  findMany(args: Record<string, unknown>): Promise<unknown[]>;
  create(args: Record<string, unknown>): Promise<unknown>;
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
}

/**
 * Base class every tenant-owned repository extends (Milestone 3's answer to
 * DATABASE_DESIGN.md Risk DB-R1's "no module may query a tenant-owned table
 * without an explicit tenant_id filter" — SYSTEM_ARCHITECTURE.md Section
 * 8.2). Every read/write here takes `tenantId` as an explicit, non-optional
 * first argument, so a tenant-less query is a compile-time signature
 * violation, not something a future module could accidentally omit inline.
 *
 * `findByIdOrThrow` is this base's first real consumer of
 * `TenantResourceNotFoundException` (reserved, unused, since ADR-005): a
 * lookup that matches an `id` belonging to a *different* tenant behaves
 * identically to a lookup that matches no row at all — `404`, never `403`,
 * per API_SPECIFICATION.md Section 2.3.1's anti-enumeration rule. This is
 * the concrete mechanism `TenantScopedGuard`'s doc comment has flagged as an
 * open per-resource-ID extension point since ADR-005.
 *
 * Cross-tenant-owned-entity relations (e.g. a future `Employee` referencing
 * a `Service`, both tenant-owned) additionally need the composite-FK
 * pattern from PRISMA_SCHEMA.md Section 14.4/DATABASE_DESIGN.md Risk DB-R1
 * at the *schema* level — this base class doesn't replace that, it's the
 * *application*-layer half of the same defense-in-depth strategy. No model
 * in this milestone's scope (`TenantSettings`, `TenantInvitation` both only
 * reference `Tenant` directly) needs the composite-FK migration step yet;
 * it's documented in TENANT_ARCHITECTURE.md as required starting Milestone 4.
 */
export abstract class TenantScopedRepository<TModel> {
  constructor(protected readonly prisma: PrismaService) {}

  /** The underlying Prisma delegate for this repository's model (e.g. `this.prisma.tenantSettings`). */
  protected abstract get delegate(): TenantScopedDelegate;

  protected async findFirstForTenant(
    tenantId: string,
    where: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<TModel | null> {
    return this.delegate.findFirst({
      where: { ...where, tenantId },
      ...(include ? { include } : {}),
    }) as Promise<TModel | null>;
  }

  protected async findByIdOrThrow(
    tenantId: string,
    id: string,
    include?: Record<string, unknown>,
  ): Promise<TModel> {
    const record = await this.findFirstForTenant(tenantId, { id }, include);
    if (!record) {
      throw new TenantResourceNotFoundException();
    }
    return record;
  }

  protected async findManyForTenant(
    tenantId: string,
    where: Record<string, unknown> = {},
    extra?: Record<string, unknown>,
  ): Promise<TModel[]> {
    return this.delegate.findMany({
      where: { ...where, tenantId },
      ...extra,
    }) as Promise<TModel[]>;
  }

  protected async createForTenant(
    tenantId: string,
    data: Record<string, unknown>,
  ): Promise<TModel> {
    return this.delegate.create({
      data: { ...data, tenantId },
    }) as Promise<TModel>;
  }

  /**
   * Updates by `id`, re-asserting `tenantId` in the `where` clause so the
   * write itself is tenant-scoped at the database level (not just verified
   * beforehand) — closes the narrow TOCTOU-style gap a separate
   * "check ownership, then update by id alone" pattern would leave open.
   *
   * Implemented as `updateMany` (which accepts an arbitrary, non-unique
   * `where`) followed by a `findUnique` re-read, rather than a single
   * `update()` call: Prisma's `update()` only accepts a `WhereUniqueInput`,
   * which doesn't admit an ad hoc `{ id, tenantId }` composite unless the
   * schema declares a compound unique index across both — not the case for
   * this milestone's models. `updateMany`'s zero-match count is what proves
   * the row either doesn't exist or belongs to a different tenant.
   */
  protected async updateForTenant(
    tenantId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<TModel> {
    const { count } = await this.delegate.updateMany({
      where: { id, tenantId },
      data,
    });
    if (count === 0) {
      throw new TenantResourceNotFoundException();
    }
    return this.delegate.findUnique({ where: { id } }) as Promise<TModel>;
  }
}
