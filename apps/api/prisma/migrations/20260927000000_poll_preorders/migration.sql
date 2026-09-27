-- A dated neighborhood poll also records a priced, unpaid pickup reservation.
ALTER TABLE "Poll"
  ADD COLUMN "serviceDate" DATE,
  ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN "readyTimes" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "dishIds" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "prices" INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN "minimumPortions" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "menuDayId" TEXT REFERENCES "MenuDay"("id"),
  ADD COLUMN "cookingOptions" INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN "finalizedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Poll_kitchenId_serviceDate_key" ON "Poll"("kitchenId", "serviceDate");
ALTER TABLE "PollVote"
  ADD COLUMN "qty" INTEGER NOT NULL DEFAULT 1 CHECK ("qty" BETWEEN 1 AND 20),
  ADD COLUMN "readyTime" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'vote_only'
    CHECK ("status" IN ('vote_only', 'awaiting_result', 'ready_for_payment', 'not_cooking', 'cancelled', 'ordered', 'expired')),
  ADD COLUMN "menuItemId" TEXT REFERENCES "MenuItem"("id"),
  ADD COLUMN "orderId" TEXT UNIQUE REFERENCES "Order"("id");
CREATE INDEX "PollVote_buyerId_status_idx" ON "PollVote"("buyerId", "status");
