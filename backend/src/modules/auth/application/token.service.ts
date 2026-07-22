import { randomBytes, createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RoleName } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string; // userId
  email: string;
  tenantId: string | null;
  roles: RoleName[];
}

export interface SignedAccessToken {
  accessToken: string;
  expiresIn: number;
}

/**
 * Reusable JWT (access token) + opaque refresh-token primitive service.
 *
 * The access token is a signed JWT (SYSTEM_ARCHITECTURE.md Section 7.1).
 * The refresh token is deliberately **not** a JWT — it is a high-entropy
 * opaque random string, tracked server-side in `RefreshToken` and only ever
 * presented back for a database lookup (SessionService). This is the
 * standard design for a long-lived, individually-revocable credential: a
 * JWT refresh token would be verifiable offline with just the signing
 * secret, which is exactly the property we don't want for a token that
 * must be revocable/rotatable/reuse-detectable by the server. Hashing it
 * with a *separate* pepper secret (`JWT_REFRESH_SECRET`, distinct from
 * `JWT_ACCESS_SECRET`) still satisfies "use separate secrets" for the two
 * credentials, while keeping each secret's blast radius independent.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  signAccessToken(payload: AccessTokenPayload): SignedAccessToken {
    const expiresIn = this.configService.getOrThrow<number>(
      'jwt.accessExpiresInSeconds',
    );
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
      expiresIn,
    });
    return { accessToken, expiresIn };
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwtService.verify<AccessTokenPayload>(token, {
      secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  /** 512 bits of entropy, URL-safe — sent to the client only as the raw cookie value, never persisted. */
  generateOpaqueRefreshToken(): string {
    return randomBytes(64).toString('base64url');
  }

  /** HMAC-SHA256, peppered with `JWT_REFRESH_SECRET` — see class doc for why this isn't a JWT. */
  hashRefreshToken(rawToken: string): string {
    const pepper = this.configService.getOrThrow<string>('jwt.refreshPepper');
    return createHmac('sha256', pepper).update(rawToken).digest('hex');
  }

  refreshTokenTtlSeconds(): number {
    return this.configService.getOrThrow<number>('jwt.refreshExpiresInSeconds');
  }
}
