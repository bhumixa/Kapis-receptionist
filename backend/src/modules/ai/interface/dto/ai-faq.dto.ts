import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** `POST /ai/tools/faq` request body (API_SPECIFICATION.md Section 12) — the one tool endpoint with no side effect. */
export class AiFaqDto {
  @ApiProperty({ example: 'What are your hours on Sunday?' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  question!: string;

  @ApiProperty()
  @IsUUID()
  conversationId!: string;
}
