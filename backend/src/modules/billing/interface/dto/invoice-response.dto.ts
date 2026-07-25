import { ApiProperty } from '@nestjs/swagger';
import { InvoiceStatus, PaymentStatus } from '@prisma/client';

export class InvoiceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() amountDueCents!: number;
  @ApiProperty() amountPaidCents!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: InvoiceStatus }) status!: InvoiceStatus;
  @ApiProperty({ nullable: true, type: String })
  invoicePdfUrl!: string | null;
  @ApiProperty() issuedAt!: string;
  @ApiProperty({ nullable: true, type: String }) dueAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) paidAt!: string | null;
}

export class PaymentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) invoiceId!: string | null;
  @ApiProperty() amountCents!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty({ nullable: true, type: String })
  failureMessage!: string | null;
  @ApiProperty() attemptedAt!: string;
}
