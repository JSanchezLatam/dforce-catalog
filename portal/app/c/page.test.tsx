// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Page from "./page";

// The SERVER render is what the static shell ships: no jsdom `render`, which would
// run the client effect and skip <noscript>.
const html = () => renderToStaticMarkup(<Page />);

describe("/c static shell", () => {
  it("carries the workshop name and the loading state, and nothing customer-derived", () => {
    const out = html();
    expect(out).toContain("DForce Car Audio");
    expect(out).toContain("Cargando");
    expect(out).not.toMatch(/Acepto|Historial de servicio|Antes de ver|Este enlace|patente/);
  });

  it("says in Spanish that JavaScript is required", () => {
    expect(html()).toMatch(/<noscript>.*JavaScript.*<\/noscript>/);
  });

  it("asks for no phone, PIN, email or cédula", () => {
    expect(html()).not.toMatch(/<(input|textarea|select|form)\b/);
  });
});
