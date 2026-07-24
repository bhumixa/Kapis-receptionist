import { ApiProperty } from '@nestjs/swagger';
import { ConversationStatus } from '@prisma/client';

export class ConversationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() customerId!: string;
  @ApiProperty() whatsappAccountId!: string;
  @ApiProperty({ enum: ConversationStatus }) status!: ConversationStatus;
  @ApiProperty({ nullable: true }) assignedUserId!: string | null;
  @ApiProperty({ nullable: true }) lastMessageAt!: string | null;
  @ApiProperty({ nullable: true }) lastInboundMessageAt!: string | null;
  @ApiProperty({ nullable: true }) resolvedAt!: string | null;
  @ApiProperty({ nullable: true }) closedAt!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
