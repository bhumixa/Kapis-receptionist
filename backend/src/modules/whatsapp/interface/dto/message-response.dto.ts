import { ApiProperty } from '@nestjs/swagger';
import {
  ActorType,
  MessageDeliveryStatus,
  MessageDirection,
  MessageType,
} from '@prisma/client';

export class MessageResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() conversationId!: string;
  @ApiProperty({ enum: MessageDirection }) direction!: MessageDirection;
  @ApiProperty({ enum: ActorType }) senderType!: ActorType;
  @ApiProperty({ nullable: true }) senderId!: string | null;
  @ApiProperty({ enum: MessageType }) messageType!: MessageType;
  @ApiProperty({ nullable: true }) content!: string | null;
  @ApiProperty({ nullable: true }) mediaWhatsappId!: string | null;
  @ApiProperty({ nullable: true }) mediaMimeType!: string | null;
  @ApiProperty({ nullable: true }) mediaFilename!: string | null;
  @ApiProperty({ nullable: true }) mediaSizeBytes!: number | null;
  @ApiProperty({ enum: MessageDeliveryStatus }) status!: MessageDeliveryStatus;
  @ApiProperty({ nullable: true }) failureReason!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
