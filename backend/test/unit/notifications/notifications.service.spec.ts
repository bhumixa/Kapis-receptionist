import { PinoLogger } from 'nestjs-pino';
import { NotificationsService } from '../../../src/modules/notifications/application/notifications.service';

const CONFIG: Record<string, unknown> = {
  'mail.smtpHost': null,
  'mail.smtpPort': 587,
  'mail.smtpSecure': false,
  'mail.smtpUser': null,
  'mail.fromAddress': 'no-reply@kapis-receptionist.example.com',
};

function buildService(configOverrides: Record<string, unknown> = {}) {
  const values = { ...CONFIG, ...configOverrides };
  const configService = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`missing config: ${key}`);
      return values[key];
    },
  };
  const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const service = new NotificationsService(
    configService as unknown as ConstructorParameters<
      typeof NotificationsService
    >[0],
    logger as unknown as PinoLogger,
  );
  return { service, logger };
}

describe('NotificationsService', () => {
  it('logs instead of sending when SMTP_HOST is unset (dev/CI fallback)', async () => {
    const { service, logger } = buildService();
    service.onModuleInit();

    await service.sendEmail({
      to: 'owner@salon.com',
      subject: 'Verify your email address',
      html: '<p>hi</p>',
      text: 'hi',
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@salon.com' }),
      expect.stringContaining('Verify your email address'),
    );
  });
});
