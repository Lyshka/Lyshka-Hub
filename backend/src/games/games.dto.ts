import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GamesInitDto {
  @IsOptional()
  @IsString()
  initData?: string;
}

export class GamesLinkDto {
  @IsOptional()
  @IsString()
  initData?: string;

  @IsString()
  @MinLength(2)
  steamInput!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountLogin?: string;
}

export class GamesProfileDto {
  @IsOptional()
  @IsString()
  initData?: string;

  @IsString()
  @MinLength(1)
  profileId!: string;
}

export class GamesUpdateProfileDto extends GamesProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountLogin?: string;
}

export class GamesWeeklyDropDto extends GamesProfileDto {
  @IsBoolean()
  done!: boolean;
}

export class Cs2ConnectorSubmitDto {
  @IsString()
  @MinLength(40)
  @MaxLength(100)
  code!: string;

  @IsString()
  @Matches(/^\d{17}$/)
  steamId!: string;

  @IsInt()
  @Min(1)
  @Max(40)
  cs2ProfileRank!: number;

  @IsInt()
  @Min(0)
  @Max(4999)
  cs2ProfileXp!: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(100000)
  cs2PremierRating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(18)
  cs2WingmanRank?: number;
}
