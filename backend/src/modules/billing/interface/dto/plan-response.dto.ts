import { ApiProperty } from '@nestjs/swagger';

export class PlanResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() monthlyPriceCents!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true, type: Number }) maxStaff!: number | null;
  @ApiProperty({ nullable: true, type: Number })
  maxMessagesPerMonth!: number | null;
  @ApiProperty() maxLocations!: number;
  @ApiProperty({ nullable: true, type: Number })
  maxAppointmentsPerMonth!: number | null;
  @ApiProperty({ nullable: true, type: Number }) maxStorageMb!: number | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() trialDays!: number;
}
