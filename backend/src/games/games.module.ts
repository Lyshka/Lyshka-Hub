import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { AuthModule } from '../auth/auth.module';
import { BotModule } from '../bot/bot.module';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { SteamGcService } from './steam-gc.service';

@Module({
  imports: [AuthModule, AppsModule, BotModule],
  controllers: [GamesController],
  providers: [GamesService, SteamGcService],
  exports: [GamesService],
})
export class GamesModule {}
