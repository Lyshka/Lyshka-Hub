import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
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

  @Post('cs2-auth/start')
  async startCs2Auth(@Body() dto: GamesProfileDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.startCs2Auth(session.user.id, dto.profileId);
  }

  @Post('cs2-auth/status')
  async cs2AuthStatus(@Body() dto: GamesProfileDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.cs2AuthStatus(session.user.id, dto.profileId);
  }

  @Post('cs2-auth/disconnect')
  async disconnectCs2Auth(@Body() dto: GamesProfileDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.disconnectCs2Auth(session.user.id, dto.profileId);
  }

  @Post('cs2-auth/sync')
  async syncCs2Auth(@Body() dto: GamesProfileDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'games',
    );
    return this.gamesService.syncCs2Auth(session.user.id, dto.profileId);
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
