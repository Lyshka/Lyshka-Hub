import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export const RATE_WATCH_KEYS = [
  'usd_buy',
  'usd_sell',
  'eur_buy',
  'eur_sell',
] as const;

export const RATE_ALERT_KEYS = ['usd_buy', 'eur_buy'] as const;

export type RateWatchKey = (typeof RATE_WATCH_KEYS)[number];
export type RateAlertKey = (typeof RATE_ALERT_KEYS)[number];

export class RatesInitDto {
  @IsOptional()
  @IsString()
  initData?: string;
}

export class RatesWatchDto {
  @IsOptional()
  @IsString()
  initData?: string;

  @IsIn(RATE_ALERT_KEYS)
  key!: RateAlertKey;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsNumber()
  @Min(0)
  threshold?: number | null;
}

export class RatesCalcDto {
  @IsOptional()
  @IsString()
  initData?: string;

  @IsNumber()
  @Min(0.01)
  amountUsd!: number;
}
