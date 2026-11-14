import "./support.css";

// Palette only, no data: the header with its counts is rendered by each page (design D11).
export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return <div className="support">{children}</div>;
}
