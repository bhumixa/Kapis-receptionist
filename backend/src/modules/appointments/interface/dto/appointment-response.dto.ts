import { ApiProperty } from '@nestjs/swagger';
import { AppointmentStatus } from '@prisma/client';

export class AppointmentServiceLineResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() serviceId!: string;
  @ApiProperty() employeeId!: string;
  @ApiProperty() serviceNameSnapshot!: string;
  @ApiProperty() durationMinutesSnapshot!: number;
  @ApiProperty() priceCentsSnapshot!: number;
  @ApiProperty() bufferMinutesSnapshot!: number;
  @ApiProperty() sequenceOrder!: number;
  @ApiProperty() startTime!: string;
  @ApiProperty() endTime!: string;
}

export class AppointmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() customerId!: string;
  @ApiProperty() employeeId!: string;
  @ApiProperty({ enum: AppointmentStatus }) status!: AppointmentStatus;
  @ApiProperty() startTime!: string;
  @ApiProperty() endTime!: string;
  @ApiProperty() totalPriceCents!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ nullable: true }) cancellationReason!: string | null;
  @ApiProperty({ nullable: true }) cancelledAt!: string | null;
  @ApiProperty({ nullable: true }) rescheduledFromAppointmentId!: string | null;
  @ApiProperty({ type: [AppointmentServiceLineResponseDto] })
  services!: AppointmentServiceLineResponseDto[];
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
