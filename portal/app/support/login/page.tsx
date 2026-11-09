import { LoginForm } from "./LoginForm";

// Public by design (see guard.test.ts). Deliberately carries none of the customer's brand.
export default function Page() {
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
