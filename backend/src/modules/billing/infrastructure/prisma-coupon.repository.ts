import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { CouponEntity } from '../domain/entities/coupon.entity';
import { CouponRepositoryPort } from '../domain/ports/coupon-repository.port';
import { toCouponEntity } from './mappers/prisma-billing.mappers';

@Injectable()
export class PrismaCouponRepository implements CouponRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode(code: string): Promise<CouponEntity | null> {
    const row = await this.prisma.coupon.findUnique({ where: { code } });
    return row ? toCouponEntity(row) : null;
  }

  async findById(id: string): Promise<CouponEntity | null> {
    const row = await this.prisma.coupon.findUnique({ where: { id } });
    return row ? toCouponEntity(row) : null;
  }

  async incrementRedemptionCount(id: string): Promise<void> {
    await this.prisma.coupon.update({
      where: { id },
      data: { redemptionCount: { increment: 1 } },
    });
  }
}
