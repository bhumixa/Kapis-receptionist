import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from '../../../core/guards/super-admin.guard';
import { CurrentUser } from '../../auth/interface/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/interface/guards/jwt-auth.guard';
import { toTenantResponseDto } from '../../auth/interface/mappers/auth-response.mapper';
import type { AccessTokenPayload } from '../../auth/application/token.service';
import { TenantLifecycleService } from '../../tenants/application/tenant-lifecycle.service';
import { TenantService } from '../../tenants/application/tenant.service';
import { paginated } from '../../../common/utils/paginated-response.util';
import { ListTenantsQueryDto } from './dto/list-tenants-query.dto';
import { SuspendTenantDto } from './dto/suspend-tenant.dto';

/**
 * `GET /admin/tenants`, `POST /admin/tenants/:id/{suspend,reactivate}`
 * (API_SPECIFICATION.md Section 16) — `SUPER_ADMIN` only, on every endpoint,
 * with no exception (the one part of the API not tenant-scoped by JWT
 * claim). A deliberately narrow slice of the full future Admin console
 * (docs/adr/ADR-006): `GET /admin/users`/`GET /admin/system` are explicit
 * Milestone 9 scope, not built here. This is the tenant-list surface the
 * frontend's tenant switcher (`X-Impersonate-Tenant-Id`) picks a target
 * tenant from, plus the two lifecycle actions Milestone 3 needs.
 *
 * Note this controller never itself reads or forwards the impersonation
 * header — a Super Admin *browsing* the tenant list to find a target is a
 * different action from *impersonating* one, which only takes effect once
 * that header is sent on a subsequent tenant-scoped request (resolved
 * exclusively by `TenantContextService`, docs/adr/ADR-006).
 */
@ApiTags('Admin')
@Controller('admin/tenants')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminTenantsController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly lifecycle: TenantLifecycleService,
  ) {}

  @Get()
  async list(@Query() query: ListTenantsQueryDto) {
    const { tenants, total } = await this.tenantService.listForAdmin({
      status: query.status,
      q: query.q,
      page: query.page,
      limit: query.limit,
    });

    return paginated(tenants.map(toTenantResponseDto), {
      pagination: {
        strategy: 'offset',
        page: query.page,
        limit: query.limit,
        totalItems: total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  }

  @Post(':id/suspend')
  async suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendTenantDto,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenant = await this.lifecycle.suspend(id, actor, dto.reason);
    return toTenantResponseDto(tenant);
  }

  @Post(':id/reactivate')
  async reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AccessTokenPayload,
  ) {
    const tenant = await this.lifecycle.reactivate(id, actor);
    return toTenantResponseDto(tenant);
  }
}
