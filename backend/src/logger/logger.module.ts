import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { Request, Response } from 'express';

/**
 * Structured (JSON) application + access logs, every line tagged with the
 * request's correlation ID (SYSTEM_ARCHITECTURE.md Section 10.9). Pretty-
 * printed in development for readability; raw JSON in every other
 * environment, ready to ship to a log aggregator.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const nodeEnv = configService.get<string>('app.nodeEnv');
        const isDevelopment = nodeEnv === 'development';

        return {
          pinoHttp: {
            level: configService.get<string>('app.logLevel') ?? 'info',
            genReqId: (req: Request) => req.requestId,
            customProps: (req: Request) => ({ requestId: req.requestId }),
            autoLogging: true,
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            transport: isDevelopment
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
            customSuccessMessage: (req: Request, res: Response) =>
              `${req.method} ${req.url} ${res.statusCode}`,
            customErrorMessage: (req: Request, res: Response) =>
              `${req.method} ${req.url} ${res.statusCode}`,
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
