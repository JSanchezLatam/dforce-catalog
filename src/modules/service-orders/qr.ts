/**
 * service-orders/qr.ts — the portal QR on the "Copia del cliente" (customer-portal WU2).
 *
 * Rendered to an SVG string on the SERVER, so the page needs no browser API at
 * all (the workshop reaches this app over plain HTTP, an insecure context) and
 * the token never reaches a client bundle. The SVG holds only the drawn
 * modules, not the text they encode.
 */
import QRCode from "qrcode";

/**
 * `margin: 1`: the sheet around the 25 mm slot is white and acts as the quiet
 * zone. No `width`: the SVG scales to its container (the slot sets the size).
 * `M` error correction survives a smudged office print.
 */
export function renderQrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}
