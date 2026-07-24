import { Inject, Injectable } from '@nestjs/common';
import { PromptVersionEntity } from '../domain/entities/prompt-version.entity';
import {
  PROMPT_VERSION_REPOSITORY,
  type PromptVersionRepositoryPort,
} from '../domain/ports/prompt-version-repository.port';

/** Thin wrapper over the registry port — backs `GET /ai/prompt-versions` (the Prompt Management UI's read model). */
@Injectable()
export class PromptVersionService {
  constructor(
    @Inject(PROMPT_VERSION_REPOSITORY)
    private readonly repository: PromptVersionRepositoryPort,
  ) {}

  listVersions(): Promise<PromptVersionEntity[]> {
    return this.repository.list();
  }

  registerActive(
    key: string,
    version: string,
    description: string | null,
  ): Promise<PromptVersionEntity> {
    return this.repository.registerActive(key, version, description);
  }
}
