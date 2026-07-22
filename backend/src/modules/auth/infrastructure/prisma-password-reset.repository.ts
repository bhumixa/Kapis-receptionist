import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { PasswordResetRecord } from '../domain/entities/password-reset-record.entity';
import {
  CreatePasswordResetInput,
  PasswordResetRepositoryPort,
} from '../domain/ports/password-reset-repository.port';

@Injectable()
export class PrismaPasswordResetRepository implements PasswordResetRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreatePasswordResetInput): Promise<PasswordResetRecord> {
    return this.prisma.passwordReset.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
  }

  findByHash(tokenHash: string): Promise<PasswordResetRecord | null> {
    return this.prisma.passwordReset.findUnique({ where: { tokenHash } });
  }

  async markUsed(id: string): Promise<void> {
    await this.prisma.passwordReset.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }

  async invalidateActiveForUser(userId: string): Promise<void> {
    // Hard delete, same rationale as email-verification tokens — an unused
    // reset token has no long-term business meaning once superseded.
    await this.prisma.passwordReset.deleteMany({
      where: { userId, usedAt: null },
    });
  }
}
