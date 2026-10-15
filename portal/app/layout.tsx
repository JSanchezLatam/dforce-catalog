import "./globals.css";

export const metadata = { robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Chrome auto-translate wraps React-owned text in <font>, so React's removeChild throws NotFoundError (Sentry DFORCE-CATALOG-A).
    <html lang="es" translate="no">
      <body>{children}</body>
    </html>
  );
}
