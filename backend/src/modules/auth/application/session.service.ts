import { Inject, Injectable } from '@nestjs/common';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepositoryPort,
} from '../domain/ports/refresh-token-repository.port';
import {
  InvalidRefreshTokenException,
  RefreshTokenReuseDetectedException,
} from './exceptions/auth.exceptions';
import { SecurityEventService } from './security-event.service';
import { TokenService } from './token.service';

export interface RequestMeta {
  userAgent: string | null;
  ipAddress: string | null;
}

export interface IssuedSession {
  id: string;
  rawRefreshToken: string;
  expiresAt: Date;
}

export interface RotatedSession extends IssuedSession {
  userId: string;
}

/**
 * Reusable session/refresh-token lifecycle service — rotation, revocation,
 * and reuse detection (SYSTEM_ARCHITECTURE.md Section 7.2). This is the
 * only place the rotation-chain invariant is implemented, so both
 * `/auth/refresh` and any future caller share identical reuse-detection
 * behavior.
 *
 * Reuse-detection design: on every rotation, the *old* row is immediately
 * marked `revokedAt` and linked forward via `replacedBySessionId` — it is
 * never deleted (needed for this very check). Only the single newest,
 * unrevoked token in a chain should ever be presented back to the server.
 * If a token is presented whose row is *already* `revokedAt` (not merely
 * expired), that is unambiguous proof it was captured and replayed after
 * the legitimate client already rotated past it — i.e. token theft. The
 * response is to revoke every other active session for that user (an
 * all-device kill-switch), since we cannot know which, if any, of the
 * user's other active sessions are also compromised.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokens: RefreshTokenRepositoryPort,
    private readonly tokenService: TokenService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  async issueSession(
    userId: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const rawRefreshToken = this.tokenService.generateOpaqueRefreshToken();
    const expiresAt = new Date(
      Date.now() + this.tokenService.refreshTokenTtlSeconds() * 1000,
    );

    const created = await this.refreshTokens.create({
      userId,
      refreshTokenHash: this.tokenService.hashRefreshToken(rawRefreshToken),
      expiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });

    return { id: created.id, rawRefreshToken, expiresAt };
  }

  async rotate(
    rawRefreshToken: string,
    meta: RequestMeta,
  ): Promise<RotatedSession> {
    const hash = this.tokenService.hashRefreshToken(rawRefreshToken);
    const record = await this.refreshTokens.findByHash(hash);

    if (!record) {
      throw new InvalidRefreshTokenException();
    }

    if (record.revokedAt) {
      // `replacedBySessionId` is only ever set by rotation (see `revoke`
      // below) — so its presence is what distinguishes true reuse (a
      // captured token replayed after the legitimate client already
      // rotated past it) from a token that's merely dead because it was
      // explicitly logged out. Only the former is a security incident
      // warranting an all-device revoke; treating a stale post-logout
      // replay as reuse would cause a logout on one device to needlessly
      // sign the user out of every *other* still-legitimate device too.
      if (record.replacedBySessionId) {
        await this.refreshTokens.revokeAllActiveForUser(record.userId);
        this.securityEvents.record('REFRESH_TOKEN_REUSE_DETECTED', {
          userId: record.userId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
        throw new RefreshTokenReuseDetectedException();
      }
      throw new InvalidRefreshTokenException();
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new InvalidRefreshTokenException();
    }

    const next = await this.issueSession(record.userId, meta);
    await this.refreshTokens.revoke(record.id, next.id);

    return { ...next, userId: record.userId };
  }

  /** Single-device logout — safe no-op if the token is unknown/already revoked (API_SPECIFICATION.md Section 4). */
  async revoke(rawRefreshToken: string): Promise<void> {
    const hash = this.tokenService.hashRefreshToken(rawRefreshToken);
    const record = await this.refreshTokens.findByHash(hash);
    if (record && !record.revokedAt) {
      await this.refreshTokens.revoke(record.id);
    }
  }

  /** All-device logout — used automatically by reuse detection; reusable by any future "sign out everywhere" action. */
  revokeAllForUser(userId: string): Promise<number> {
    return this.refreshTokens.revokeAllActiveForUser(userId);
  }
}
