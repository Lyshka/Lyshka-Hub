import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { RatesService } from './rates.service';
import { RatesUpdate } from './rates.update';

@Module({
  imports: [BotModule],
  providers: [RatesService, RatesUpdate],
  exports: [RatesService],
})
export class RatesModule {}
