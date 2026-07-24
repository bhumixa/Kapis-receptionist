import { PromptVersionEntity } from '../entities/prompt-version.entity';

export const PROMPT_VERSION_REPOSITORY = Symbol('PROMPT_VERSION_REPOSITORY');

export interface PromptVersionRepositoryPort {
  list(): Promise<PromptVersionEntity[]>;
  findActiveByKey(key: string): Promise<PromptVersionEntity | null>;
  /**
   * Self-registering: `PromptBuilderService` calls this on every load of a
   * template file, so the DB registry (ops/debugging visibility) always
   * reflects reality without a separate manual seed/admin step — the file
   * on disk remains the single source of truth for content and version
   * identifier, this just records "this version exists and is active."
   * Deactivates any other row sharing the same `key` in the same call.
   */
  registerActive(
    key: string,
    version: string,
    description: string | null,
  ): Promise<PromptVersionEntity>;
}
