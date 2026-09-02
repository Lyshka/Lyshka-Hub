import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { AuthModule } from '../auth/auth.module';
import { BotModule } from '../bot/bot.module';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

@Module({
  imports: [AuthModule, AppsModule, BotModule],
  controllers: [GamesController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}
