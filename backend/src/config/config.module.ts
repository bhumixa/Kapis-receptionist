import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import {
  accountSecurityConfig,
  appConfig,
  databaseConfig,
  jwtConfig,
  loginSecurityConfig,
  mailConfig,
  rbacConfig,
  redisConfig,
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
      ],
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
