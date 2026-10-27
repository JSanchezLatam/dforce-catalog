/** Chrome-less on purpose: no sidebar, no header. These pages are shown on a TV. */
export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh p-6 text-xl">{children}</main>;
}
