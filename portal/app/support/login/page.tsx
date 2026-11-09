import { redirect } from "next/navigation";

import { requireSupport } from "../../../src/support/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

// Public by design (see guard.test.ts): it only skips the form for someone already signed in.
// Deliberately carries none of the customer's brand.
export default async function Page() {
  if (await requireSupport()) redirect("/support");
  return (
    <>
      <header className="masthead">
        <p className="brand">Soporte — Dforce</p>
      </header>
      <main className="page narrow">
        <div className="card">
          <h1 className="title">Soporte — Dforce</h1>
          <p className="muted small">Acceso solo para el equipo de desarrollo.</p>
          <LoginForm />
        </div>
      </main>
    </>
  );
}
