ALTER TABLE "SteamProfile" ADD COLUMN "cs2AuthToken" TEXT;
ALTER TABLE "SteamProfile" ADD COLUMN "cs2AuthConnectedAt" TIMESTAMP(3);
ALTER TABLE "SteamProfile" ADD COLUMN "cs2AuthAccountName" TEXT;
UPDATE "SteamProfile"
SET
  "cs2ProfileRank" = NULL,
  "cs2ProfileXp" = NULL
WHERE "cs2AuthToken" IS NULL;
