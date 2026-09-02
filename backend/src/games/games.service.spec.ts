import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppsService } from '../apps/apps.service';
import { BotService } from '../bot/bot.service';
import { PrismaService } from '../prisma/prisma.service';
import { GamesService } from './games.service';

type TransactionMock = {
  cs2ConnectorChallenge: {
    findFirst: jest.Mock;
    updateMany: jest.Mock;
  };
  steamProfile: {
    update: jest.Mock;
  };
};

function createService(transaction: TransactionMock) {
  const prisma = {
    $transaction: async (
      callback: (value: TransactionMock) => Promise<unknown>,
    ) => callback(transaction),
  } as unknown as PrismaService;

  return new GamesService(
    prisma,
    {} as ConfigService,
    {} as BotService,
    {} as AppsService,
  );
}

const input = {
  code: 'a'.repeat(43),
  steamId: '76561198000000000',
  cs2ProfileRank: 18,
  cs2ProfileXp: 2418,
  cs2PremierRating: 12000,
  cs2WingmanRank: 8,
};

describe('GamesService CS2 local connector', () => {
  it('rejects a result for another Steam account', async () => {
    const transaction: TransactionMock = {
      cs2ConnectorChallenge: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'challenge',
          steamProfileId: 'profile',
          steamProfile: { steamId: '76561198000000001' },
        }),
        updateMany: jest.fn(),
      },
      steamProfile: {
        update: jest.fn(),
      },
    };
    const service = createService(transaction);

    await expect(service.submitCs2LocalUpdate(input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transaction.cs2ConnectorChallenge.updateMany).not.toHaveBeenCalled();
    expect(transaction.steamProfile.update).not.toHaveBeenCalled();
  });

  it('rejects a reused connector code', async () => {
    const transaction: TransactionMock = {
      cs2ConnectorChallenge: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'challenge',
          steamProfileId: 'profile',
          steamProfile: { steamId: input.steamId },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      steamProfile: {
        update: jest.fn(),
      },
    };
    const service = createService(transaction);

    await expect(service.submitCs2LocalUpdate(input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transaction.steamProfile.update).not.toHaveBeenCalled();
  });

  it('stores exact CS2 values after consuming a valid code', async () => {
    const transaction: TransactionMock = {
      cs2ConnectorChallenge: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'challenge',
          steamProfileId: 'profile',
          steamProfile: { steamId: input.steamId },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      steamProfile: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const service = createService(transaction);

    await expect(service.submitCs2LocalUpdate(input)).resolves.toEqual({
      ok: true,
    });
    expect(transaction.steamProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'profile' },
        data: expect.objectContaining({
          cs2ProfileRank: 18,
          cs2ProfileXp: 2418,
          cs2PremierRating: 12000,
          cs2WingmanRank: 8,
        }),
      }),
    );
  });
});
