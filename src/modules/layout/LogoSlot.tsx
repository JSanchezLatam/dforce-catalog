// ponytail: "D" letter mark — swap for a real <Image> brand logo once an
// asset exists; the 40px rounded-square frame is the contract to preserve
// (confirmed OpenPencil mockup: brand mark atop the 72px icon rail).
export function LogoSlot() {
  return (
    <div className="flex h-16 items-center justify-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-dash-purple text-sm font-bold text-dash-fg">
        D
      </div>
    </div>
  );
}
