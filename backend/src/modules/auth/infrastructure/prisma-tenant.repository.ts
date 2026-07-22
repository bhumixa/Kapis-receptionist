import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AuthTenant } from '../domain/entities/auth-tenant.entity';
import { TenantRepositoryPort } from '../domain/ports/tenant-repository.port';
import { toAuthTenant } from './mappers/prisma-auth.mappers';

@Injectable()
export class PrismaTenantRepository implements TenantRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<AuthTenant | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    return tenant ? toAuthTenant(tenant) : null;
  }
}
