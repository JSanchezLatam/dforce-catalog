import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dforce Catalog",
  description: "Dforce Car catalog generation system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-dragon-bg text-dragon-fg">{children}</body>
    </html>
  );
}
