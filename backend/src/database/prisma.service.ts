import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Thin wrapper around PrismaClient providing the app's single database
 * connection (SYSTEM_ARCHITECTURE.md Section 11.7 — one pooled Prisma
 * connection per backend instance). Explicit connect/disconnect on the
 * Nest lifecycle avoids relying on Prisma's implicit lazy-connect, so a
 * broken database is caught at startup (/health/ready) rather than on the
 * first request that happens to touch it.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }
}
