import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { OnboardingWizard } from "./_components/wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { tenantId } = await requireTenant();
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { tradeName: true, onboardingCompletedAt: true },
  });
  if (tenant?.onboardingCompletedAt) redirect("/dashboard");
  return <OnboardingWizard initialName={tenant?.tradeName ?? ""} />;
}
