import { Module } from '@nestjs/common';
import { BotModule } from '../bot/bot.module';
import { RatesService } from './rates.service';

@Module({
  imports: [BotModule],
  providers: [RatesService],
})
export class RatesModule {}
