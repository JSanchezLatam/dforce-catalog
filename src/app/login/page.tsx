import { LoginForm } from "@/modules/auth/LoginForm";

/**
 * R9.1 — the only route `proxy.ts`'s blanket guard excludes (see its
 * `matcher`). No `requireSession`/`can()` call — a session is exactly what
 * this page exists to obtain.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-dragon-bg">
      <div className="w-full max-w-sm rounded-lg bg-dragon-sidebar-bg p-8 shadow-md">
        <h1 className="mb-6 text-center text-2xl font-bold text-dragon-fg">Sign in</h1>
        <LoginForm />
      </div>
    </main>
  );
}
