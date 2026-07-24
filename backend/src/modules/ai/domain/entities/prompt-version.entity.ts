/**
 * Ops/debugging registry row — "which version of this prompt is currently
 * active," not the prompt content itself (that lives in versioned files
 * under `modules/ai/prompts/`, SYSTEM_ARCHITECTURE.md 5.1). Backs the
 * Prompt Management UI (`GET /ai/prompt-versions`) and post-hoc debugging
 * ("this bad booking happened under prompt v3", SYSTEM_ARCHITECTURE.md 5.6).
 */
export interface PromptVersionEntity {
  id: string;
  key: string;
  version: string;
  description: string | null;
  isActive: boolean;
  releasedAt: Date | null;
  createdAt: Date;
}
