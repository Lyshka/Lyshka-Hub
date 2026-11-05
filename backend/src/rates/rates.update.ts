import { Action, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { RATE_ALERT_KEYS, type RateAlertKey } from './rates.dto';
import { RatesService } from './rates.service';

@Update()
export class RatesUpdate {
  constructor(private readonly ratesService: RatesService) {}

  @Action(/^rates:seen:(.+)$/)
  async onSeen(@Ctx() ctx: Context & { match?: RegExpExecArray }) {
    const userId = ctx.from?.id;
    const key = ctx.match?.[1] ?? '';

    if (!userId || !this.isAlertKey(key)) {
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

  private isAlertKey(value: string): value is RateAlertKey {
    return (RATE_ALERT_KEYS as readonly string[]).includes(value);
  }
}
