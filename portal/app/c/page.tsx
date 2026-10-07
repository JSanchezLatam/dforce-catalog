import { PortalClient } from "./PortalClient";

// Static shell: renders once, carries no customer data and no token. The visitor's
// token lives in the URL fragment, which only the client component can read.
export default function Page() {
  return (
    <>
      <header className="masthead">
        <p className="brand">DForce Car Audio</p>
      </header>
      <main className="page">
        <PortalClient />
        <noscript>
          <p className="notice">Necesitás activar JavaScript en tu navegador para ver tu historial de servicio.</p>
        </noscript>
      </main>
    </>
  );
}
