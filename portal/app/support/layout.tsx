import { requireSupport } from "../../src/support/session";
import { statusCounts } from "../../src/support/queries";
import { LogoutButton } from "./LogoutButton";
import { SupportNav } from "./SupportNav";
import "./support.css";

// Not the auth boundary (a layout does not re-run on client navigation): every page checks the
// session itself. Without one this is the login page, which keeps its own header and gets no nav.
export default async function SupportLayout({ children }: { children: React.ReactNode }) {
  if (!(await requireSupport())) return children;
  const { nuevo } = await statusCounts();
  return (
    <>
      <header className="masthead">
        <div className="bar">
          <p className="brand">Soporte — Dforce</p>
          <SupportNav nuevo={nuevo} />
          <LogoutButton />
        </div>
      </header>
      {children}
    </>
  );
}
