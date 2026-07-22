import { Module } from '@nestjs/common';
import { NotificationsService } from './application/notifications.service';

@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
