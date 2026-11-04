import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppsService } from '../apps/apps.service';
import { UsersService } from '../users/users.service';
import { validateTelegramInitData } from './telegram-init-data';

function serializeUser(user: {
  id: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
}) {
  return {
    id: Number(user.id),
    username: user.username ?? undefined,
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
    languageCode: user.languageCode ?? undefined,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly appsService: AppsService,
  ) {}

  isAdmin(userId: number): boolean {
    return this.appsService.isAdmin(userId);
  }

  async authenticate(initData: string) {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      throw new UnauthorizedException('Токен бота не настроен');
    }

    if (!initData?.trim()) {
      throw new UnauthorizedException(
        'Открой приложение через кнопку бота в Telegram',
      );
    }

    const validated = validateTelegramInitData(initData, token);
    if (!validated) {
      throw new ForbiddenException('Невалидные данные Telegram WebApp');
    }

    const user = await this.usersService.upsertFromTelegram({
      id: validated.user.id,
      first_name: validated.user.first_name,
      last_name: validated.user.last_name,
      username: validated.user.username,
      language_code: validated.user.language_code,
    });

    const userId = Number(user.id);
    const isAdmin = this.appsService.isAdmin(userId);

    if (isAdmin) {
      await this.appsService.setGrant(userId, 'meds', true).catch(() => undefined);
      await this.appsService.setGrant(userId, 'cats', true).catch(() => undefined);
      await this.appsService
        .setGrant(userId, 'games', true)
        .catch(() => undefined);
      await this.appsService
        .setGrant(userId, 'stats', true)
        .catch(() => undefined);
      await this.appsService
        .setGrant(userId, 'links', true)
        .catch(() => undefined);
      await this.appsService
        .setGrant(userId, 'rates', true)
        .catch(() => undefined);
    }

    const apps = await this.appsService.listForUser(userId);

    return {
      user: {
        ...serializeUser(user),
        photoUrl: validated.user.photo_url,
        isPremium: Boolean(validated.user.is_premium),
        isAdmin,
      },
      apps,
      isAdmin,
      mode: 'telegram' as const,
    };
  }

  async authenticateApp(initData: string, appSlug: string) {
    const session = await this.authenticate(initData);
    await this.appsService.assertAccess(session.user.id, appSlug);
    return session;
  }
}
