import { LoginForm } from "@/modules/auth/LoginForm";
import { Card, CardContent } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-6 pt-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
              aria-hidden="true"
            >
              D
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Dforce Catálogo</h1>
              <p className="text-sm text-muted-foreground">Inicia sesión para continuar</p>
            </div>
          </div>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
