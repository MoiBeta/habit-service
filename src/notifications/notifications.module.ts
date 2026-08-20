import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { FirebaseService } from './firebase.service';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [DevicesController],
  providers: [DevicesService, NotificationSchedulerService, FirebaseService],
  exports: [DevicesService],
})
export class NotificationsModule {}
