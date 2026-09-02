ALTER TABLE "SteamProfile" DROP COLUMN IF EXISTS "cs2AuthToken";
ALTER TABLE "SteamProfile" DROP COLUMN IF EXISTS "cs2AuthConnectedAt";
ALTER TABLE "SteamProfile" DROP COLUMN IF EXISTS "cs2AuthAccountName";
ALTER TABLE "SteamProfile" ADD COLUMN "cs2ExactSyncedAt" TIMESTAMP(3);

CREATE TABLE "Cs2ConnectorChallenge" (
  "id" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "userId" BIGINT NOT NULL,
  "steamProfileId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Cs2ConnectorChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Cs2ConnectorChallenge_secretHash_key"
  ON "Cs2ConnectorChallenge"("secretHash");
CREATE INDEX "Cs2ConnectorChallenge_userId_expiresAt_idx"
  ON "Cs2ConnectorChallenge"("userId", "expiresAt");
CREATE INDEX "Cs2ConnectorChallenge_steamProfileId_expiresAt_idx"
  ON "Cs2ConnectorChallenge"("steamProfileId", "expiresAt");
CREATE INDEX "Cs2ConnectorChallenge_expiresAt_idx"
  ON "Cs2ConnectorChallenge"("expiresAt");

ALTER TABLE "Cs2ConnectorChallenge"
  ADD CONSTRAINT "Cs2ConnectorChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Cs2ConnectorChallenge"
  ADD CONSTRAINT "Cs2ConnectorChallenge_steamProfileId_fkey"
  FOREIGN KEY ("steamProfileId") REFERENCES "SteamProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
