import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { RatesCalcDto, RatesInitDto, RatesWatchDto } from './rates.dto';
import { RatesService } from './rates.service';

@Controller('rates')
export class RatesController {
  constructor(
    private readonly authService: AuthService,
    private readonly ratesService: RatesService,
  ) {}

  @Post('overview')
  async overview(@Body() dto: RatesInitDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'rates',
    );
    return this.ratesService.overview(session.user.id);
  }

  @Post('watch')
  async watch(@Body() dto: RatesWatchDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'rates',
    );
    return this.ratesService.updateWatch(session.user.id, dto.key, {
      enabled: dto.enabled,
      threshold: dto.threshold,
    });
  }

  @Post('calc')
  async calc(@Body() dto: RatesCalcDto) {
    const session = await this.authService.authenticateApp(
      dto.initData ?? '',
      'rates',
    );
    return this.ratesService.calculate(session.user.id, dto.amountUsd);
  }
}
