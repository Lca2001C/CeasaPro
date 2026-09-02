-- Caixa de entrada do super-admin (avisos operacionais do SaaS, com estado de lido).

-- CreateEnum
CREATE TYPE "AdminNotificationKind" AS ENUM ('USER_CREATED');

-- CreateTable
CREATE TABLE "admin_notifications" (
    "id" TEXT NOT NULL,
    "kind" "AdminNotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "tenantId" TEXT,
    "userId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Atende a consulta da campainha: contar nao lidas e listar as recentes primeiro.
CREATE INDEX "admin_notifications_readAt_createdAt_idx" ON "admin_notifications"("readAt", "createdAt");
