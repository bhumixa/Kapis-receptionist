import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import nodemailer, { Transporter } from 'nodemailer';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Minimal `Notifications` module capability (SYSTEM_ARCHITECTURE.md Section
 * 3.2's `NotificationsService.sendEmail`), pulled forward from Milestone 9's
 * full templated/logged build-out to just what this sprint's email
 * verification and password reset flows need — no `NotificationTemplate`/
 * `NotificationLog` tables yet (PRISMA_SCHEMA.md's future model list), per
 * the same minimal-forward-provisioning precedent ADR-002/ADR-003 already
 * established elsewhere in this codebase.
 *
 * If `SMTP_HOST` is unset (local dev, CI, integration tests), the email is
 * logged instead of sent, so these flows work with zero mail infrastructure
 * — the same log-first fallback philosophy `SecurityEventService` uses.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private transporter: Transporter | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationsService.name);
  }

  onModuleInit(): void {
    const host = this.configService.get<string | null>('mail.smtpHost');
    if (!host) {
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: this.configService.getOrThrow<number>('mail.smtpPort'),
      secure: this.configService.getOrThrow<boolean>('mail.smtpSecure'),
      auth: this.configService.get<string | null>('mail.smtpUser')
        ? {
            user: this.configService.get<string>('mail.smtpUser'),
            pass: this.configService.get<string>('mail.smtpPass'),
          }
        : undefined,
    });
  }

  async sendEmail(input: SendEmailInput): Promise<void> {
    if (!this.transporter) {
      this.logger.info(
        { to: input.to, subject: input.subject },
        `[dev] Email not sent (SMTP_HOST unset) — logged instead: ${input.subject}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.configService.getOrThrow<string>('mail.fromAddress'),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
  }
}
