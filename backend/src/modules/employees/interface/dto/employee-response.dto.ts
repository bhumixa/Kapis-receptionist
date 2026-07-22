import { ApiProperty } from '@nestjs/swagger';
import { EmployeeStatus } from '@prisma/client';

export class EmployeeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true }) userId!: string | null;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ nullable: true }) phoneNumber!: string | null;
  @ApiProperty({ enum: EmployeeStatus }) status!: EmployeeStatus;
  @ApiProperty({ nullable: true }) colorTag!: string | null;
  @ApiProperty({ nullable: true }) bio!: string | null;
  @ApiProperty({ type: [String] }) serviceIds!: string[];
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
