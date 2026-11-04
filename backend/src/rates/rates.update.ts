import { Action, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { RATE_WATCH_KEYS, type RateWatchKey } from './rates.dto';
import { RatesService } from './rates.service';

@Update()
export class RatesUpdate {
  constructor(private readonly ratesService: RatesService) {}

  @Action(/^rates:seen:(.+)$/)
  async onSeen(@Ctx() ctx: Context & { match?: RegExpExecArray }) {
    const userId = ctx.from?.id;
    const key = ctx.match?.[1] ?? '';

    if (!userId || !this.isWatchKey(key)) {
      return;
    }

    await this.ratesService.muteWatchForToday(userId, key);

    try {
      await ctx.answerCbQuery('Ок, сегодня больше не напомню');
    } catch {
      //
    }

    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch {
      //
    }
  }

  private isWatchKey(value: string): value is RateWatchKey {
    return (RATE_WATCH_KEYS as readonly string[]).includes(value);
  }
}
