import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import { AwsClient } from "aws4fetch";

/**
 * Fotos de produto de ponta a ponta, contra o Cloudflare R2 DE VERDADE.
 *
 * Só roda com as cinco `R2_*` no .env (mesmo critério de `pwa-push.spec.ts`
 * com as chaves VAPID): sem bucket não há o que testar, e o cadastro sem foto já
 * é coberto por `produtos.spec.ts`.
 *
 * Cobre os três caminhos do modal — Galeria, Câmera e Banco — e o envio do
 * super-admin para o Banco. Confere no bucket (pela API S3, não pelo domínio
 * público, que tem cache) que a foto foi gravada comprimida e que a foto
 * trocada foi apagada. Tudo o que o teste grava no bucket e no banco é apagado
 * no fim.
 */

const e = process.env;
const R2_CONFIGURADO = Boolean(
  e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_BUCKET && e.R2_PUBLIC_URL,
);
const PUBLICO = (e.R2_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");

const prisma = new PrismaClient();
const s3 = R2_CONFIGURADO
  ? new AwsClient({
      accessKeyId: e.R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: e.R2_SECRET_ACCESS_KEY!.trim(),
      service: "s3",
      region: "auto",
    })
  : null;
const urlDoObjeto = (key: string) =>
  `https://${e.R2_ACCOUNT_ID!.trim()}.r2.cloudflarestorage.com/${e.R2_BUCKET!.trim()}/${key}`;
const existeNoBucket = async (key: string) =>
  (await s3!.fetch(urlDoObjeto(key), { method: "HEAD" })).status === 200;

const sufixo = `${Date.now()}${randomBytes(2).toString("hex")}`;
const NOME_GALERIA = `Foto Galeria ${sufixo}`;
const NOME_BANCO = `Fotobanco ${sufixo}`;
const ADMIN_EMAIL = `admin-fotos-${sufixo}@teste-ceasapro.com.br`;
const ADMIN_SENHA = "admin-fotos-1234";

const criados = { produtos: [] as string[], chaves: [] as string[], admins: [] as string[] };

/**
 * Uma foto de verdade (1600×1200, maior que o lado máximo de 1024), desenhada
 * num canvas do próprio navegador — assim o teste exercita a redução e a
 * conversão que o celular faria, sem arquivo binário no repositório.
 */
async function fotoDeTeste(page: Page) {
  const base64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1200;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 1600, 1200);
    grad.addColorStop(0, "#c0392b");
    grad.addColorStop(1, "#27ae60");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1600, 1200);
    return c.toDataURL("image/png").split(",")[1]!;
  });
  return { name: "tomate.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

async function abrirNovoProduto(page: Page, nome: string) {
  await page.goto("/estoque?novo=1");
  const dialogo = page.getByRole("dialog", { name: "Novo Produto" });
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel(/Nome do Produto/).fill(nome);
  return dialogo;
}

async function produtoGravado(nome: string) {
  const p = await prisma.product.findFirstOrThrow({
    where: { name: nome, deletedAt: null },
    select: { id: true, tenantId: true, imageKey: true },
  });
  criados.produtos.push(p.id);
  return p;
}

test.skip(!R2_CONFIGURADO, "R2_* não configuradas no .env — sem bucket para testar");

test.afterAll(async () => {
  if (!R2_CONFIGURADO) return;
  const produtos = await prisma.product.findMany({
    where: { OR: [{ name: { contains: sufixo } }, { id: { in: criados.produtos } }] },
    select: { id: true, imageKey: true },
  });
  const ids = produtos.map((p) => p.id);
  for (const p of produtos) if (p.imageKey) criados.chaves.push(p.imageKey);
  const fotosDoBanco = await prisma.catalogoImagem.findMany({
    where: { nome: { contains: sufixo } },
    select: { imageKey: true },
  });
  criados.chaves.push(...fotosDoBanco.map((f) => f.imageKey));

  await prisma.stockMovement.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  await prisma.catalogoImagem.deleteMany({ where: { nome: { contains: sufixo } } });
  await prisma.user.deleteMany({ where: { id: { in: criados.admins } } });
  for (const key of new Set(criados.chaves)) {
    await s3!.fetch(urlDoObjeto(key), { method: "DELETE" }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

test.describe.serial("fotos de produto no R2", () => {
  test("Galeria: a foto sobe comprimida, o produto guarda a chave da empresa e o cartão a mostra", async ({
    page,
    request,
  }) => {
    const dialogo = await abrirNovoProduto(page, NOME_GALERIA);
    await expect(dialogo.getByTestId("foto-galeria")).toBeEnabled();
    await dialogo.getByTestId("foto-galeria").setInputFiles(await fotoDeTeste(page));

    // Prévia aparece e o Salvar só libera depois do envio.
    await expect(dialogo.getByRole("img", { name: "Foto do produto" })).toBeVisible();
    const salvar = dialogo.getByRole("button", { name: "Salvar Produto" });
    await expect(salvar).toBeEnabled({ timeout: 20_000 });
    await salvar.click();
    await expect(page.getByText("Produto cadastrado")).toBeVisible();
    await expect(dialogo).toBeHidden();

    const p = await produtoGravado(NOME_GALERIA);
    const chaveDaEmpresa = new RegExp(
      "^tenants/" + p.tenantId + "/produtos/[0-9a-f-]{36}\\.(webp|jpg|png)$",
    );
    expect(p.imageKey).toMatch(chaveDaEmpresa);
    expect(await existeNoBucket(p.imageKey!)).toBe(true);

    // Chegou comprimida: o PNG de 1600×1200 não pode ter subido cru.
    const head = await s3!.fetch(urlDoObjeto(p.imageKey!), { method: "HEAD" });
    expect(Number(head.headers.get("content-length"))).toBeLessThan(300 * 1024);
    expect(head.headers.get("content-type")).toMatch(/^image\/(webp|jpeg)$/);

    // O cartão do Estoque exibe a foto direto do domínio público.
    await page.getByLabel("Buscar produto no estoque").fill(NOME_GALERIA);
    const miniatura = page.locator(`main img[src="${PUBLICO}/${p.imageKey}"]`);
    await expect(miniatura).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => miniatura.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);

    const r = await request.get(`${PUBLICO}/${p.imageKey}`);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toMatch(/^image\//);
  });

  test("Câmera: trocar a foto grava a nova e apaga a antiga do bucket", async ({ page }) => {
    const antes = await produtoGravado(NOME_GALERIA);
    expect(antes.imageKey).toBeTruthy();

    await page.goto(`/estoque?editar=${antes.id}`);
    const dialogo = page.getByRole("dialog", { name: "Editar produto" });
    await expect(dialogo).toBeVisible();
    await dialogo.getByTestId("foto-camera").setInputFiles(await fotoDeTeste(page));
    const salvar = dialogo.getByRole("button", { name: "Salvar alterações" });
    await expect(salvar).toBeEnabled({ timeout: 20_000 });
    await salvar.click();
    await expect(page.getByText("Produto atualizado")).toBeVisible();

    const depois = await produtoGravado(NOME_GALERIA);
    criados.chaves.push(antes.imageKey!);
    expect(depois.imageKey).not.toBe(antes.imageKey);
    expect(await existeNoBucket(depois.imageKey!)).toBe(true);
    await expect.poll(() => existeNoBucket(antes.imageKey!), { timeout: 10_000 }).toBe(false);
  });

  test("Banco: o super-admin envia a foto e a empresa a escolhe no cadastro", async ({
    page,
    browser,
  }) => {
    // 1) Super-admin dedicado (o do seed nasce com troca de senha obrigatória).
    const admin = await prisma.user.create({
      data: {
        tenantId: null,
        name: "Admin Fotos E2E",
        email: ADMIN_EMAIL,
        passwordHash: await hash(ADMIN_SENHA, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
        role: "SUPER_ADMIN",
        active: true,
        mustChangePassword: false,
      },
    });
    criados.admins.push(admin.id);
    await prisma.rateLimit.deleteMany({});

    const ctxAdmin = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const adminPage = await ctxAdmin.newPage();
    await adminPage.goto("/login");
    await adminPage.getByLabel("E-mail").fill(ADMIN_EMAIL);
    await adminPage.getByLabel("Senha", { exact: true }).fill(ADMIN_SENHA);
    await adminPage.getByRole("button", { name: "Entrar" }).click();
    await adminPage.waitForURL(/\/admin/, { timeout: 15_000 });

    await adminPage.goto("/admin/imagens");
    await adminPage.locator('input[type="file"]').setInputFiles(await fotoDeTeste(adminPage));
    await adminPage.getByLabel("Nome do produto").fill(NOME_BANCO);
    await adminPage.getByRole("button", { name: "Adicionar ao banco" }).click();
    await expect(adminPage.getByText("Foto adicionada ao banco")).toBeVisible({ timeout: 20_000 });
    await expect(adminPage.getByLabel(`Nome da foto ${NOME_BANCO}`)).toBeVisible();
    await ctxAdmin.close();

    const doBanco = await prisma.catalogoImagem.findFirstOrThrow({ where: { nome: NOME_BANCO } });
    expect(doBanco.imageKey).toMatch(/^catalogo\/[0-9a-f-]{36}\.(webp|jpg|png)$/);
    expect(await existeNoBucket(doBanco.imageKey)).toBe(true);

    // 2) A empresa cadastra um produto escolhendo essa foto no Banco.
    const dialogo = await abrirNovoProduto(page, NOME_BANCO);
    await dialogo.getByRole("button", { name: /Banco/ }).click();
    await expect(dialogo.getByLabel("Buscar no banco de fotos")).toHaveValue(NOME_BANCO);
    await dialogo.getByRole("button", { name: `Usar a foto ${NOME_BANCO}` }).click();
    await expect(dialogo.getByRole("img", { name: "Foto do produto" })).toHaveAttribute(
      "src",
      `${PUBLICO}/${doBanco.imageKey}`,
    );
    await dialogo.getByRole("button", { name: "Salvar Produto" }).click();
    await expect(page.getByText("Produto cadastrado")).toBeVisible();

    const p = await produtoGravado(NOME_BANCO);
    expect(p.imageKey).toBe(doBanco.imageKey);
  });
});
