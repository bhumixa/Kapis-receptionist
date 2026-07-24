import { ApiProperty } from '@nestjs/swagger';
import { WhatsAppConnectionStatus } from '@prisma/client';

/**
 * Deliberately excludes `accessTokenEncrypted` — the decrypted token is
 * never returned to any client, only ever decrypted immediately before an
 * outbound Cloud API call (`WhatsAppAccountService.getSendableAccount`).
 */
export class WhatsAppAccountResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() phoneNumber!: string;
  @ApiProperty() whatsappPhoneNumberId!: string;
  @ApiProperty() whatsappBusinessAccountId!: string;
  @ApiProperty({ enum: WhatsAppConnectionStatus })
  connectionStatus!: WhatsAppConnectionStatus;
  @ApiProperty({ nullable: true }) connectedAt!: string | null;
  @ApiProperty({ nullable: true }) disconnectedAt!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
