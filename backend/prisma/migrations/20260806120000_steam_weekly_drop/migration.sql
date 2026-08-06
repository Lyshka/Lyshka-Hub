ALTER TABLE "SteamProfile" ADD COLUMN "weeklyDropDone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SteamProfile" ADD COLUMN "weeklyDropDoneAt" TIMESTAMP(3);

CREATE INDEX "SteamProfile_weeklyDropDone_idx" ON "SteamProfile"("weeklyDropDone");
