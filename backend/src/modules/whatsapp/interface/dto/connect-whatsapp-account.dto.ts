import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** `POST /whatsapp/account` request body (API_SPECIFICATION.md Section 11). */
export class ConnectWhatsAppAccountDto {
  @ApiProperty({ example: '+15551234567' })
  @IsString()
  phoneNumber!: string;

  @ApiProperty({ example: '109876543210987' })
  @IsString()
  whatsappPhoneNumberId!: string;

  @ApiProperty({ example: '123456789012345' })
  @IsString()
  whatsappBusinessAccountId!: string;

  @ApiProperty({
    description: 'A permanent or system-user access token issued by Meta.',
  })
  @IsString()
  @MinLength(10)
  accessToken!: string;
}
