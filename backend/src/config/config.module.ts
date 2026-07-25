import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import {
  accountSecurityConfig,
  aiConfig,
  appConfig,
  billingConfig,
  databaseConfig,
  jwtConfig,
  loginSecurityConfig,
  mailConfig,
  rbacConfig,
  redisConfig,
  tenantsConfig,
  whatsappConfig,
} from './configuration';
import { validateEnv } from './env.validation';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        jwtConfig,
        mailConfig,
        loginSecurityConfig,
        accountSecurityConfig,
        rbacConfig,
        tenantsConfig,
        whatsappConfig,
        aiConfig,
        billingConfig,
      ],
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
