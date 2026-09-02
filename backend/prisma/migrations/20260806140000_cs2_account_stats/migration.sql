ALTER TABLE "SteamProfile" ADD COLUMN "steamLevel" INTEGER;
ALTER TABLE "SteamProfile" ADD COLUMN "cs2Hours" DOUBLE PRECISION;
ALTER TABLE "SteamProfile" ADD COLUMN "cs2PremierRating" INTEGER;
ALTER TABLE "SteamProfile" ADD COLUMN "cs2ProfileRank" INTEGER;
ALTER TABLE "SteamProfile" ADD COLUMN "cs2ProfileXp" INTEGER;
ALTER TABLE "SteamProfile" ADD COLUMN "cs2WingmanRank" INTEGER;
ALTER TABLE "SteamProfile" ADD COLUMN "cs2StatsSyncedAt" TIMESTAMP(3);
