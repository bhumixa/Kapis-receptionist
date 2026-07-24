import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** `POST /messages/send` request body (API_SPECIFICATION.md Section 11). */
export class SendMessageDto {
  @ApiProperty()
  @IsUUID()
  conversationId!: string;

  @ApiProperty({ example: 'Your appointment is confirmed for 2pm tomorrow.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  body!: string;
}
