import { CouponEntity } from '../entities/coupon.entity';

export const COUPON_REPOSITORY = Symbol('COUPON_REPOSITORY');

export interface CouponRepositoryPort {
  findByCode(code: string): Promise<CouponEntity | null>;
  findById(id: string): Promise<CouponEntity | null>;
  incrementRedemptionCount(id: string): Promise<void>;
}
