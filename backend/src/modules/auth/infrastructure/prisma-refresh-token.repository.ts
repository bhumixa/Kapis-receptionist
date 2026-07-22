import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { RefreshTokenRecord } from '../domain/entities/refresh-token-record.entity';
import {
  CreateRefreshTokenInput,
  RefreshTokenRepositoryPort,
} from '../domain/ports/refresh-token-repository.port';

@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord> {
    return this.prisma.refreshToken.create({
      data: {
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
      },
    });
  }

  findByHash(refreshTokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.prisma.refreshToken.findUnique({
      where: { refreshTokenHash },
    });
  }

  async revoke(id: string, replacedBySessionId?: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date(), replacedBySessionId },
    });
  }

  async revokeAllActiveForUser(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}
