-- CreateTable
CREATE TABLE "RateWatch" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "threshold" DOUBLE PRECISION,
    "mutedOn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateWatch_userId_idx" ON "RateWatch"("userId");

-- CreateIndex
CREATE INDEX "RateWatch_enabled_idx" ON "RateWatch"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "RateWatch_userId_key_key" ON "RateWatch"("userId", "key");

-- AddForeignKey
ALTER TABLE "RateWatch" ADD CONSTRAINT "RateWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
