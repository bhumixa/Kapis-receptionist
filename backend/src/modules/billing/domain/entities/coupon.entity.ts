import { CouponDiscountType, CouponDurationType } from '@prisma/client';

/** Global, mirrors a Stripe Coupon. */
export interface CouponEntity {
  id: string;
  code: string;
  stripeCouponId: string;
  discountType: CouponDiscountType;
  discountValue: number;
  durationType: CouponDurationType;
  durationInMonths: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  expiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
