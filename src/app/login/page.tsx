import { LoginForm } from "@/modules/auth/LoginForm";

/**
 * R9.1 — the only route `proxy.ts`'s blanket guard excludes (see its
 * `matcher`). No `requireSession`/`can()` call — a session is exactly what
 * this page exists to obtain.
 */
export default function LoginPage() {
  return (
    <main>
      <h1>Sign in</h1>
      <LoginForm />
    </main>
  );
}
