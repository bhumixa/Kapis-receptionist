import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV,
  port: parseInt(process.env.PORT ?? '3000', 10),
  name: process.env.APP_NAME,
  corsOrigin: process.env.CORS_ORIGIN,
  logLevel: process.env.LOG_LEVEL ?? 'info',
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
}));

export const redisConfig = registerAs('redis', () => ({
  url: process.env.REDIS_URL,
}));

export const jwtConfig = registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET,
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  accessExpiresInSeconds: parseInt(
    process.env.JWT_ACCESS_EXPIRES_IN_SECONDS ?? '900',
    10,
  ),
  // Not used to sign a JWT — see TokenService/SessionService: this peppers
  // the HMAC used to hash the opaque refresh token before storage, keeping
  // it a genuinely separate secret from the access-token signing key even
  // though the refresh token itself is never a JWT.
  refreshPepper: process.env.JWT_REFRESH_SECRET,
  refreshExpiresInSeconds: parseInt(
    process.env.JWT_REFRESH_EXPIRES_IN_SECONDS ?? `${60 * 60 * 24 * 30}`,
    10,
  ),
}));
