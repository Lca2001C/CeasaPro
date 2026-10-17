-- CreateEnum
CREATE TYPE "NoticiaTema" AS ENUM ('CEASA', 'PRECOS', 'CLIMA', 'LOGISTICA', 'SAFRA', 'ECONOMIA');

-- CreateEnum
CREATE TYPE "NoticiaColetaStatus" AS ENUM ('OK', 'FALHA');

-- AlterEnum
ALTER TYPE "AdminNotificationKind" ADD VALUE 'NOTICIAS_FALHA';

-- CreateTable
CREATE TABLE "noticias" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "chaveTitulo" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "feed" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "resumo" TEXT NOT NULL DEFAULT '',
    "publicadaEm" TIMESTAMP(3) NOT NULL,
    "imagemUrl" TEXT,
    "temas" "NoticiaTema"[],
    "pontuacao" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "noticias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "noticias_coletas" (
    "id" TEXT NOT NULL,
    "feed" TEXT NOT NULL,
    "status" "NoticiaColetaStatus" NOT NULL,
    "lidos" INTEGER NOT NULL DEFAULT 0,
    "aceitos" INTEGER NOT NULL DEFAULT 0,
    "novos" INTEGER NOT NULL DEFAULT 0,
    "httpStatus" INTEGER,
    "erro" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "noticias_coletas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "noticias_url_key" ON "noticias"("url");

-- CreateIndex
CREATE UNIQUE INDEX "noticias_chaveTitulo_key" ON "noticias"("chaveTitulo");

-- CreateIndex
CREATE INDEX "noticias_publicadaEm_idx" ON "noticias"("publicadaEm");

-- CreateIndex
CREATE INDEX "noticias_coletas_feed_createdAt_idx" ON "noticias_coletas"("feed", "createdAt");

-- CreateIndex
CREATE INDEX "noticias_coletas_createdAt_idx" ON "noticias_coletas"("createdAt");
