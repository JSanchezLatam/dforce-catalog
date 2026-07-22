// ponytail: text placeholder — swap the text node for an <Image> brand logo
// once a real asset exists; the 48px-tall centered frame is the contract to
// preserve (confirmed OpenPencil mockup).
export function LogoSlot() {
  return (
    <div className="flex h-12 items-center justify-center text-sm font-semibold">
      Dforce Catálogo
    </div>
  );
}
