import { LogoutButton } from "./LogoutButton";
import { SupportNav } from "./SupportNav";
import "./support.css";

// Rendered by each page, not a layout: a layout renders concurrently with its page and would read the count before markRead.
export function SupportHeader({ nuevo }: { nuevo: number }) {
  return (
    <header className="masthead">
      <div className="bar">
        <p className="brand">Soporte — Dforce</p>
        <SupportNav nuevo={nuevo} />
        <LogoutButton />
      </div>
    </header>
  );
}
