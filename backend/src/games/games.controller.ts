import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  Cs2ConnectorSubmitDto,
  GamesInitDto,
  GamesLinkDto,
  GamesProfileDto,
  GamesUpdateProfileDto,
  GamesWeeklyDropDto,
} from './games.dto';
import { GamesService } from './games.service';

@Controller('games')
export class GamesController {
  constructor(
    private readonly authService: AuthService,
    private readonly gamesService: GamesService,
  ) {}

  @Post('overview')
  async overview(@Body() dto: GamesInitDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.overview(session.user.id);
  }

  @Post('link')
  async link(@Body() dto: GamesLinkDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.linkProfile(session.user.id, dto.steamInput, {
      accountEmail: dto.accountEmail,
      accountLogin: dto.accountLogin,
    });
  }

  @Post('update')
  async update(@Body() dto: GamesUpdateProfileDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.updateProfile(session.user.id, dto.profileId, {
      accountEmail: dto.accountEmail,
      accountLogin: dto.accountLogin,
    });
  }

  @Post('cs2-local/start')
  async startCs2LocalUpdate(@Body() dto: GamesProfileDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.startCs2LocalUpdate(session.user.id, dto.profileId);
  }

  @Post('cs2-local/status')
  async cs2LocalUpdateStatus(@Body() dto: GamesProfileDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.cs2LocalUpdateStatus(session.user.id, dto.profileId);
  }

  @Post('cs2-local/submit')
  async submitCs2LocalUpdate(@Body() dto: Cs2ConnectorSubmitDto) {
    return this.gamesService.submitCs2LocalUpdate(dto);
  }

  @Post('weekly-drop')
  async weeklyDrop(@Body() dto: GamesWeeklyDropDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.setWeeklyDrop(
      session.user.id,
      dto.profileId,
      dto.done,
    );
  }

  @Post('select')
  async select(@Body() dto: GamesProfileDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.selectProfile(session.user.id, dto.profileId);
  }

  @Post('delete')
  async remove(@Body() dto: GamesProfileDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.deleteProfile(session.user.id, dto.profileId);
  }

  @Post('sync')
  async sync(@Body() dto: GamesInitDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.syncAll(session.user.id, session.isAdmin);
  }

  @Post('inventory')
  async inventory(@Body() dto: GamesInitDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.getInventory(session.user.id);
  }
}
