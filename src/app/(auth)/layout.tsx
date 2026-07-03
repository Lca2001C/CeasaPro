export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-secondary/40 p-4">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-primary">CeasaPro</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestão simples para o seu box no CEASA
        </p>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
