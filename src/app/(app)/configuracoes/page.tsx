import Link from "next/link";
import { requireTenant } from "@/lib/auth/session";
import { ConfigService } from "@/lib/services/config.service";
import { formatBRL, formatDate } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/data/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmpresaConfigForm } from "./_components/empresa-form";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const { tenantId } = await requireTenant();
  const t = await ConfigService.getCompany(tenantId);
  const sub = t?.subscription;

  return (
    <div>
      <PageHeader title="Configurações" description="Dados da empresa e assinatura." />
      <Tabs defaultValue="empresa">
        <TabsList>
          <TabsTrigger value="empresa">Empresa</TabsTrigger>
          <TabsTrigger value="assinatura">Assinatura</TabsTrigger>
        </TabsList>
        <TabsContent value="empresa">
          <EmpresaConfigForm
            initial={{
              tradeName: t?.tradeName ?? "",
              legalName: t?.legalName ?? "",
              cnpj: t?.cnpj ?? "",
              phone: t?.phone ?? "",
              address: t?.address ?? "",
              businessHours: t?.businessHours ?? "",
            }}
          />
        </TabsContent>
        <TabsContent value="assinatura">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sua assinatura</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {sub ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Plano</span>
                    <span>{sub.plan.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Situação</span>
                    <span>{SUBSCRIPTION_STATUS_LABELS[sub.status]}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mensalidade</span>
                    <span>{formatBRL(sub.monthlyAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Vencimento</span>
                    <span>{formatDate(sub.currentPeriodEnd)}</span>
                  </div>
                  <Button asChild className="mt-2">
                    <Link href="/assinatura">Ver / pagar mensalidade</Link>
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground">Nenhuma assinatura ativa.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
