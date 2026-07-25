import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionStatus } from '@prisma/client';
import { PlanResponseDto } from './plan-response.dto';

export class SubscriptionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() planId!: string;
  @ApiProperty({ type: PlanResponseDto }) plan!: PlanResponseDto;
  @ApiProperty({ enum: SubscriptionStatus }) status!: SubscriptionStatus;
  @ApiProperty({ nullable: true, type: String })
  currentPeriodStart!: string | null;
  @ApiProperty({ nullable: true, type: String })
  currentPeriodEnd!: string | null;
  @ApiProperty() cancelAtPeriodEnd!: boolean;
  @ApiProperty({ nullable: true, type: String }) canceledAt!: string | null;
  @ApiProperty() messagesUsedCurrentPeriod!: number;
  @ApiProperty() hasStripeSubscription!: boolean;
}
