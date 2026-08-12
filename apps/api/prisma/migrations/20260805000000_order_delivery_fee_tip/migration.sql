-- Delivery courier fee + optional tip, charged on the order total (Story 3.4 checkout).
ALTER TABLE "Order" ADD COLUMN "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "tipCents" INTEGER NOT NULL DEFAULT 0;
