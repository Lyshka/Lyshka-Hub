import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const CATALOG = [
  {
    slug: 'meds',
    name: 'Таблетки',
    description: 'Напоминания и учёт приёма',
    icon: 'meds',
    color: '#0f766e',
    sortOrder: 10,
    isSystem: false,
  },
  {
    slug: 'cats',
    name: 'Котики',
    description: 'Милый котик и тёплый текст каждый день',
    icon: 'cats',
    color: '#ea580c',
    sortOrder: 20,
    isSystem: false,
  },
  {
    slug: 'games',
    name: 'Игры',
    description: 'Steam wishlist — что есть и чего нет',
    icon: 'games',
    color: '#1b2838',
    sortOrder: 40,
    isSystem: false,
  },
  {
    slug: 'stats',
    name: 'Статистика',
    description: 'CS2 / Faceit / Leetify по Steam профилю',
    icon: 'stats',
    color: '#0e7490',
    sortOrder: 50,
    isSystem: false,
  },
  {
    slug: 'links',
    name: 'Ссылки',
    description: 'Разделы, темы и полезные ссылки',
    icon: 'links',
    color: '#65a30d',
    sortOrder: 60,
    isSystem: false,
  },
  {
    slug: 'buy',
    name: 'Покупки',
    description: 'Списки покупок — личные и общие по коду',
    icon: 'buy',
    color: '#a21caf',
    sortOrder: 65,
    isSystem: false,
  },
  {
    slug: 'rates',
    name: 'Курсы',
    description: 'Приорбанк по карте, планки и калькулятор вывода',
    icon: 'rates',
    color: '#0369a1',
    sortOrder: 70,
    isSystem: false,
  },
  {
    slug: 'admin',
    name: 'Админка',
    description: 'Пользователи и доступы',
    icon: 'admin',
    color: '#1e293b',
    sortOrder: 1000,
    isSystem: true,
  },
] as const;

function serializeApp(app: {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  sortOrder: number;
  isSystem: boolean;
}) {
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    description: app.description,
    icon: app.icon,
    color: app.color,
    sortOrder: app.sortOrder,
    isSystem: app.isSystem,
  };
}

@Injectable()
export class AppsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureCatalog();
  }

  getAdminIds(): number[] {
    const raw = this.configService.get<string>('ADMIN_IDS') ?? '';
    return raw
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isFinite(id) && id > 0);
  }

  isAdmin(userId: number): boolean {
    return this.getAdminIds().includes(userId);
  }

  assertAdmin(userId: number) {
    if (!this.isAdmin(userId)) {
      throw new ForbiddenException('Только для администратора');
    }
  }

  async ensureCatalog() {
    await this.renameStudyAppToLinks();
    await this.deactivateHealthApp();
    await this.deactivateFinanceApp();

    for (const item of CATALOG) {
      await this.prisma.app.upsert({
        where: { slug: item.slug },
        create: { ...item },
        update: {
          name: item.name,
          description: item.description,
          icon: item.icon,
          color: item.color,
          sortOrder: item.sortOrder,
          isSystem: item.isSystem,
          active: true,
        },
      });
    }

    const meds = await this.prisma.app.findUnique({ where: { slug: 'meds' } });
    if (!meds) {
      return;
    }

    for (const adminId of this.getAdminIds()) {
      const uid = BigInt(adminId);
      const user = await this.prisma.user.findUnique({ where: { id: uid } });
      if (!user) {
        continue;
      }
      await this.prisma.userAppGrant.upsert({
        where: {
          userId_appId: {
            userId: uid,
            appId: meds.id,
          },
        },
        create: {
          userId: uid,
          appId: meds.id,
        },
        update: {},
      });
    }
  }

  private async deactivateHealthApp() {
    await this.prisma.app.updateMany({
      where: { slug: 'health' },
      data: { active: false },
    });
  }

  private async deactivateFinanceApp() {
    const app = await this.prisma.app.findUnique({ where: { slug: 'finance' } });
    if (!app) {
      return;
    }
    await this.prisma.userAppGrant.deleteMany({ where: { appId: app.id } });
    await this.prisma.app.update({
      where: { id: app.id },
      data: { active: false },
    });
  }

  private async renameStudyAppToLinks() {
    const legacy = await this.prisma.app.findUnique({ where: { slug: 'study' } });
    if (!legacy) {
      return;
    }

    const current = await this.prisma.app.findUnique({ where: { slug: 'links' } });
    if (!current) {
      await this.prisma.app.update({
        where: { id: legacy.id },
        data: {
          slug: 'links',
          name: 'Ссылки',
          description: 'Разделы, темы и полезные ссылки',
          icon: 'links',
        },
      });
      return;
    }

    const grants = await this.prisma.userAppGrant.findMany({
      where: { appId: legacy.id },
    });
    for (const grant of grants) {
      await this.prisma.userAppGrant.upsert({
        where: {
          userId_appId: {
            userId: grant.userId,
            appId: current.id,
          },
        },
        create: {
          userId: grant.userId,
          appId: current.id,
        },
        update: {},
      });
    }
    await this.prisma.userAppGrant.deleteMany({ where: { appId: legacy.id } });
    await this.prisma.app.delete({ where: { id: legacy.id } });
  }

  async listForUser(userId: number) {
    const admin = this.isAdmin(userId);
    const apps = await this.prisma.app.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });

    if (admin) {
      return apps.map(serializeApp);
    }

    const grants = await this.prisma.userAppGrant.findMany({
      where: { userId: BigInt(userId) },
      select: { appId: true },
    });
    const granted = new Set(grants.map((g) => g.appId));

    return apps
      .filter((app) => !app.isSystem && granted.has(app.id))
      .map(serializeApp);
  }

  async hasAccess(userId: number, slug: string): Promise<boolean> {
    if (slug === 'admin') {
      return this.isAdmin(userId);
    }
    if (this.isAdmin(userId)) {
      return true;
    }

    const app = await this.prisma.app.findFirst({
      where: { slug, active: true, isSystem: false },
    });
    if (!app) {
      return false;
    }

    const grant = await this.prisma.userAppGrant.findUnique({
      where: {
        userId_appId: {
          userId: BigInt(userId),
          appId: app.id,
        },
      },
    });
    return Boolean(grant);
  }

  async assertAccess(userId: number, slug: string) {
    const ok = await this.hasAccess(userId, slug);
    if (!ok) {
      throw new ForbiddenException('Нет доступа к этому приложению');
    }
  }

  async listSubscriberIds(slug: string): Promise<number[]> {
    const app = await this.prisma.app.findFirst({
      where: { slug, active: true, isSystem: false },
    });
    if (!app) {
      return [];
    }

    const grants = await this.prisma.userAppGrant.findMany({
      where: { appId: app.id },
      select: { userId: true },
    });
    const ids = new Set(grants.map((g) => Number(g.userId)));

    for (const adminId of this.getAdminIds()) {
      ids.add(adminId);
    }

    return [...ids];
  }

  async listAllApps() {
    const apps = await this.prisma.app.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
    return apps.map(serializeApp);
  }

  async listUsersWithGrants(onlyWithAccess = false) {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        appGrants: {
          include: { app: true },
        },
      },
    });

    const mapped = users.map((user) => this.serializeAdminUser(user));
    if (!onlyWithAccess) {
      return mapped;
    }
    return mapped.filter((user) => user.grants.length > 0);
  }

  async searchUsers(query: string) {
    const normalized = query.trim().replace(/^@+/, '');
    if (!normalized) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      include: {
        appGrants: {
          include: { app: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const lower = normalized.toLowerCase();
    const filtered = users.filter((user) => {
      const idMatch = String(user.id).includes(normalized);
      const usernameMatch = user.username?.toLowerCase().includes(lower) ?? false;
      const firstNameMatch = user.firstName?.toLowerCase().includes(lower) ?? false;
      const lastNameMatch = user.lastName?.toLowerCase().includes(lower) ?? false;
      return idMatch || usernameMatch || firstNameMatch || lastNameMatch;
    });

    return filtered.slice(0, 20).map((user) => this.serializeAdminUser(user));
  }

  private serializeAdminUser(user: {
    id: bigint;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    createdAt: Date;
    appGrants: {
      app: {
        id: string;
        slug: string;
        name: string;
        isSystem: boolean;
      };
    }[];
  }) {
    return {
      id: Number(user.id),
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt.toISOString(),
      isAdmin: this.isAdmin(Number(user.id)),
      grants: user.appGrants
        .filter((g) => !g.app.isSystem)
        .map((g) => ({
          appId: g.app.id,
          slug: g.app.slug,
          name: g.app.name,
        })),
    };
  }

  async setGrant(userId: number, appSlug: string, enabled: boolean) {
    const app = await this.prisma.app.findFirst({
      where: { slug: appSlug, active: true },
    });
    if (!app) {
      throw new NotFoundException('Приложение не найдено');
    }
    if (app.isSystem) {
      throw new ForbiddenException('Системное приложение не выдаётся через гранты');
    }

    const uid = BigInt(userId);
    const existingUser = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!existingUser) {
      throw new NotFoundException(
        'Пользователь не найден. Сначала он должен написать боту /start',
      );
    }

    if (!enabled && this.isAdmin(userId)) {
      throw new ForbiddenException('Нельзя снимать доступы у администратора');
    }

    if (enabled) {
      await this.prisma.userAppGrant.upsert({
        where: {
          userId_appId: { userId: uid, appId: app.id },
        },
        create: { userId: uid, appId: app.id },
        update: {},
      });
    } else {
      await this.prisma.userAppGrant.deleteMany({
        where: { userId: uid, appId: app.id },
      });
    }

    return { ok: true };
  }
}
