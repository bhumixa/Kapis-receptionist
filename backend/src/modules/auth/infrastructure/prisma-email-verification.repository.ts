import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { EmailVerificationRecord } from '../domain/entities/email-verification-record.entity';
import {
  CreateEmailVerificationInput,
  EmailVerificationRepositoryPort,
} from '../domain/ports/email-verification-repository.port';

@Injectable()
export class PrismaEmailVerificationRepository implements EmailVerificationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  create(
    input: CreateEmailVerificationInput,
  ): Promise<EmailVerificationRecord> {
    return this.prisma.emailVerification.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
  }

  findByHash(tokenHash: string): Promise<EmailVerificationRecord | null> {
    return this.prisma.emailVerification.findUnique({ where: { tokenHash } });
  }

  async markVerified(id: string): Promise<void> {
    await this.prisma.emailVerification.update({
      where: { id },
      data: { verifiedAt: new Date() },
    });
  }

  async invalidateActiveForUser(userId: string): Promise<void> {
    // Hard delete: an unverified verification token carries no long-term
    // business meaning (DATABASE_DESIGN.md Section 1.6's ephemeral-table
    // guidance), so superseding it on resend is a delete, not a soft-revoke.
    await this.prisma.emailVerification.deleteMany({
      where: { userId, verifiedAt: null },
    });
  }
}
