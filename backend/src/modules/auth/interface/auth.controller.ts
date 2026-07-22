import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import {
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_PATH,
  THROTTLE_PUBLIC_SENSITIVE,
  THROTTLE_STANDARD_AUTHENTICATED,
} from '../../../common/constants/auth.constants';
import { AuthService } from '../application/auth.service';
import { RequestMeta } from '../application/session.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  toTenantResponseDto,
  toUserResponseDto,
} from './mappers/auth-response.mapper';

/** API_SPECIFICATION.md Section 4 — `/api/v1/auth/*`. */
@ApiTags('Auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @SkipThrottle({ [THROTTLE_STANDARD_AUTHENTICATED]: true })
  @Throttle({ [THROTTLE_PUBLIC_SENSITIVE]: { limit: 10, ttl: 60_000 } })
  async register(@Body() dto: RegisterDto) {
    const { user, tenant } = await this.authService.register(dto);
    return {
      user: toUserResponseDto(user),
      tenant: toTenantResponseDto(tenant),
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle({ [THROTTLE_STANDARD_AUTHENTICATED]: true })
  @Throttle({ [THROTTLE_PUBLIC_SENSITIVE]: { limit: 10, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(
      dto,
      this.requestMeta(request),
    );
    this.setRefreshCookie(response, session.rawRefreshToken);

    return {
      user: toUserResponseDto(session.user),
      tenant: session.tenant ? toTenantResponseDto(session.tenant) : null,
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle({ [THROTTLE_PUBLIC_SENSITIVE]: true })
  @Throttle({ [THROTTLE_STANDARD_AUTHENTICATED]: { limit: 120, ttl: 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const rawRefreshToken = this.readRefreshCookie(request);
    const session = await this.authService.refresh(
      rawRefreshToken,
      this.requestMeta(request),
    );
    this.setRefreshCookie(response, session.rawRefreshToken);

    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @SkipThrottle({ [THROTTLE_PUBLIC_SENSITIVE]: true })
  @Throttle({ [THROTTLE_STANDARD_AUTHENTICATED]: { limit: 120, ttl: 60_000 } })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const rawRefreshToken = this.readRefreshCookie(request);
    if (rawRefreshToken) {
      await this.authService.logout(rawRefreshToken);
    }
    this.clearRefreshCookie(response);
    return { message: 'Logged out.' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle({ [THROTTLE_PUBLIC_SENSITIVE]: true })
  @Throttle({ [THROTTLE_STANDARD_AUTHENTICATED]: { limit: 120, ttl: 60_000 } })
  async me(@CurrentUser() currentUser: { sub: string }) {
    const { user, tenant } = await this.authService.me(currentUser.sub);
    return {
      user: toUserResponseDto(user),
      tenant: tenant ? toTenantResponseDto(tenant) : null,
    };
  }

  private requestMeta(request: Request): RequestMeta {
    return {
      userAgent: request.headers['user-agent'] ?? null,
      ipAddress: request.ip ?? null,
    };
  }

  private readRefreshCookie(request: Request): string {
    const token = (request.cookies as Record<string, string> | undefined)?.[
      REFRESH_TOKEN_COOKIE_NAME
    ];
    // Deliberately the same generic 401 as an invalid token — never reveal
    // whether the absence is "no cookie" vs "bad cookie" to the client.
    if (!token) {
      throw new UnauthorizedException();
    }
    return token;
  }

  private setRefreshCookie(response: Response, rawRefreshToken: string): void {
    response.cookie(
      REFRESH_TOKEN_COOKIE_NAME,
      rawRefreshToken,
      this.cookieOptions(),
    );
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    const isProduction =
      this.configService.get<string>('app.nodeEnv') === 'production';
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: REFRESH_TOKEN_COOKIE_PATH,
      maxAge:
        this.configService.getOrThrow<number>('jwt.refreshExpiresInSeconds') *
        1000,
    };
  }
}
