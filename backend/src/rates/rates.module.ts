import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { AuthModule } from '../auth/auth.module';
import { BotModule } from '../bot/bot.module';
import { RatesController } from './rates.controller';
import { RatesService } from './rates.service';
import { RatesUpdate } from './rates.update';

@Module({
  imports: [AuthModule, AppsModule, BotModule],
  controllers: [RatesController],
  providers: [RatesService, RatesUpdate],
  exports: [RatesService],
})
export class RatesModule {}