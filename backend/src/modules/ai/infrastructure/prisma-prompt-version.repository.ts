import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { PromptVersionEntity } from '../domain/entities/prompt-version.entity';
import { PromptVersionRepositoryPort } from '../domain/ports/prompt-version-repository.port';
import { toPromptVersionEntity } from './mappers/prisma-ai.mappers';

/** Global registry, not tenant-owned — no `tenantId` column (see `schema.prisma`'s `PromptVersion` doc comment). */
@Injectable()
export class PrismaPromptVersionRepository implements PromptVersionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<PromptVersionEntity[]> {
    const rows = await this.prisma.promptVersion.findMany({
      orderBy: [{ key: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(toPromptVersionEntity);
  }

  async findActiveByKey(key: string): Promise<PromptVersionEntity | null> {
    const row = await this.prisma.promptVersion.findFirst({
      where: { key, isActive: true },
    });
    return row ? toPromptVersionEntity(row) : null;
  }

  async registerActive(
    key: string,
    version: string,
    description: string | null,
  ): Promise<PromptVersionEntity> {
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.promptVersion.updateMany({
        where: { key, isActive: true, version: { not: version } },
        data: { isActive: false },
      });
      return tx.promptVersion.upsert({
        where: { uq_prompt_versions_key_version: { key, version } },
        create: {
          key,
          version,
          description,
          isActive: true,
          releasedAt: now,
        },
        update: {
          description,
          isActive: true,
          releasedAt: now,
        },
      });
    });
    return toPromptVersionEntity(row);
  }
}
