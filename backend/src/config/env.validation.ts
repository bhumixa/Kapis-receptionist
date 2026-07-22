import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MinLength,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

class EnvironmentVariables {
  @IsIn(Object.values(NodeEnv))
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  APP_NAME: string = 'Kapis Receptionist API';

  @IsString()
  CORS_ORIGIN: string = 'http://localhost:4200';

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
  @IsOptional()
  LOG_LEVEL: string = 'info';

  @IsString()
  DATABASE_URL: string;

  @IsUrl({ protocols: ['redis', 'rediss'], require_tld: false })
  REDIS_URL: string;

  // --- Auth (docs/AUTHENTICATION.md) ---
  // Two independent secrets by design: ACCESS signs/verifies the JWT access
  // token; REFRESH peppers the HMAC used to hash the opaque refresh token
  // before it's stored (never a JWT signing key) — compromise of one never
  // compromises the other.
  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsInt()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN_SECONDS: number = 900;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET: string;

  @IsInt()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN_SECONDS: number = 60 * 60 * 24 * 30;
}

/**
 * Fail-fast bootstrap validation (SYSTEM_ARCHITECTURE.md 10.6): a missing or
 * malformed required variable throws here, before the app starts listening,
 * rather than surfacing later as an obscure runtime error at first use.
 */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Invalid environment configuration: ${messages}`);
  }

  return validated;
}
