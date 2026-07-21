import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';

type DependencyStatus = 'connected' | 'unavailable';

interface ReadinessBody {
  status: 'ok' | 'error';
  database: DependencyStatus;
  redis: DependencyStatus;
}

/**
 * SYSTEM_ARCHITECTURE.md Section 10.10: a shallow liveness check (process is
 * up, nothing more) is deliberately distinguished from a deep readiness
 * check (dependencies are actually reachable), so Docker Compose/deploy
 * tooling can tell "still starting" apart from "crashed" and act correctly
 * on each.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness check — process is up.' })
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness check — database and Redis are reachable.',
  })
  async readiness(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessBody> {
    const [database, redis] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ]);

    const databaseConnected = database.status === 'fulfilled';
    const redisConnected = redis.status === 'fulfilled';
    const allHealthy = databaseConnected && redisConnected;

    res.status(allHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: allHealthy ? 'ok' : 'error',
      database: databaseConnected ? 'connected' : 'unavailable',
      redis: redisConnected ? 'connected' : 'unavailable',
    };
  }
}
