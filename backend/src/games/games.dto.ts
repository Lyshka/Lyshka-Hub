import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
