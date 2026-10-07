-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "productName" VARCHAR(255) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
