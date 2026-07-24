import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { validationExceptionFactory } from './common/pipes/validation-exception-factory';

async function bootstrap() {
  // rawBody: true (docs/WHATSAPP_ARCHITECTURE.md) — `POST /webhooks/whatsapp`
  // verifies Meta's X-Hub-Signature-256 HMAC against the exact raw request
  // bytes; re-serializing the parsed JSON body would not reliably reproduce
  // Meta's original byte sequence.
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);

  // `webhooks/whatsapp` is unversioned/unprefixed, same rationale as
  // `health` — Meta's webhook callback URL is registered once in the App
  // Dashboard and shouldn't move if the API's version prefix ever changes,
  // and it isn't called through this platform's own versioned API client.
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'health/ready', 'webhooks/whatsapp'],
  });

  app.enableCors({
    origin: configService.get<string>('app.corsOrigin'),
    credentials: true,
  });

  // Required to read the httpOnly refresh-token cookie
  // (SYSTEM_ARCHITECTURE.md Section 7.2) on /auth/refresh and /auth/logout.
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle(configService.get<string>('app.name') ?? 'Kapis Receptionist API')
    .setDescription(
      'AI-powered WhatsApp appointment booking platform for salons — REST API.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  const port = configService.get<number>('app.port') ?? 3000;
  await app.listen(port);
}
void bootstrap();
