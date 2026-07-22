import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ARGON2ID_OPTIONS } from '../../../common/constants/auth.constants';

/**
 * Reusable password hashing/verification service — Argon2id, production
 * parameters documented in docs/AUTHENTICATION.md and
 * common/constants/auth.constants.ts. The only place `argon2` is imported
 * in the codebase, so the algorithm/parameters can only change in one spot.
 */
@Injectable()
export class PasswordService {
  hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, {
      type: argon2.argon2id,
      ...ARGON2ID_OPTIONS,
    });
  }

  verify(hash: string, plainPassword: string): Promise<boolean> {
    return argon2.verify(hash, plainPassword);
  }
}
