import { Action, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { RatesService, RATES_EUR_SEEN_CALLBACK } from './rates.service';

@Update()
export class RatesUpdate {
  constructor(private readonly ratesService: RatesService) {}

  @Action(RATES_EUR_SEEN_CALLBACK)
  async onEurSeen(@Ctx() ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }

    this.ratesService.muteAlertsForToday(userId);

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
}
