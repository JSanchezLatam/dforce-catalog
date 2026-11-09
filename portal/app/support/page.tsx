import { redirect } from "next/navigation";

import { requireSupport } from "../../src/support/session";

export const dynamic = "force-dynamic";

// Placeholder behind the guard: the inbox itself lands in the next work unit.
export default async function Page() {
  if (!(await requireSupport())) redirect("/support/login");
  return (
    <>
      <header className="masthead">
        <p className="brand">Soporte — Dforce</p>
      </header>
      <main className="page">
        <h1 className="title">Soporte — Dforce</h1>
      </main>
    </>
  );
}
