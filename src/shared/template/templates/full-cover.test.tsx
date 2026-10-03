import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { BackProps, CoverProps } from "../registry-types";
import { Back, Cover, splitTitle, titleSize } from "./full-cover";

/*
 * In the Next server graph (the pdf-generate worker runs inside it via
 * instrumentation.ts) lucide-react is a "use client" module: calling any of its
 * exports from renderToStaticMarkup throws. Vitest resolves it as a plain module,
 * so mock it to throw the same way — a template that imports it fails here too.
 */
vi.mock("lucide-react", () => ({
  __esModule: true,
  ...Object.fromEntries(
    ["Clock", "Globe", "Mail", "MapPin", "MessageCircle", "Phone", "Icon"].map((name) => [
      name,
      () => {
        throw new Error(`Attempted to call the default export of lucide-react (${name}) from the server, but it's on the client.`);
      },
    ]),
  ),
}));

const RED = "#D42027";
const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const imgs = (markup: string) => Array.from(new DOMParser().parseFromString(markup, "text/html").querySelectorAll("img"));
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const cover = (overrides: Partial<CoverProps> = {}): CoverProps => ({
  title: "Catálogo: Repuestos",
  logoUrl: "data:image/jpeg;base64,LOGO",
  coverImageUrl: "data:image/jpeg;base64,PHOTO",
  workshopName: "DForce Car Audio",
  coverText: "Catálogo de productos",
  red: RED,
  ...overrides,
});

const back = (overrides: Partial<BackProps> = {}): BackProps => ({
  rows: [
    { key: "phone", label: "TELÉFONO", value: "203-7212" },
    { key: "whatsapp", label: "WHATSAPP", value: "6591-8064" },
    { key: "email", label: "CORREO", value: "dforcecar@gmail.com" },
    { key: "hours", label: "HORARIO", value: "Lunes a Sábado" },
    { key: "address", label: "DIRECCIÓN", value: "Rio Abajo, Calle 14." },
  ],
  socials: [
    ["Instagram", "@dforcecar"],
    ["Facebook", "D Force Car"],
  ],
  logoUrl: "data:image/jpeg;base64,LOGO",
  coverImageUrl: "data:image/jpeg;base64,PHOTO",
  red: RED,
  ...overrides,
});

describe("splitTitle", () => {
  it("splits on the FIRST \": \" into a lead and the main line", () => {
    expect(splitTitle("Catálogo: Repuestos")).toEqual({ lead: "Catálogo:", main: "Repuestos" });
    expect(splitTitle("Catálogo: Audio: Premium")).toEqual({ lead: "Catálogo:", main: "Audio: Premium" });
  });

  it("makes the whole title the main line when there is no \": \"", () => {
    expect(splitTitle("Catálogo")).toEqual({ lead: null, main: "Catálogo" });
    expect(splitTitle("Catálogo:Repuestos")).toEqual({ lead: null, main: "Catálogo:Repuestos" });
  });
});

describe("titleSize", () => {
  it("steps 118 / 84 / 64 at 12 and 24 characters", () => {
    expect(titleSize("A".repeat(12))).toBe(118);
    expect(titleSize("A".repeat(13))).toBe(84);
    expect(titleSize("A".repeat(24))).toBe(84);
    expect(titleSize("A".repeat(25))).toBe(64);
  });
});

describe("Cover", () => {
  it("prints the lead light at 54px and the main line heavy at its stepped size", () => {
    const markup = html(<Cover {...cover()} />);

    expect(markup).toMatch(/font-size:54px[^>]*>Catálogo:</);
    expect(markup).toMatch(/font-weight:800[^>]*>Repuestos</);
    expect(markup).toContain("font-size:118px");
  });

  it("steps the main line down for a longer title", () => {
    expect(html(<Cover {...cover({ title: "Catálogo: Audio y Video" })} />)).toContain("font-size:84px");
    expect(html(<Cover {...cover({ title: "Catálogo: Audio, video y accesorios varios" })} />)).toContain("font-size:64px");
  });

  it("prints a bare title as the main line only, with no lead", () => {
    const markup = html(<Cover {...cover({ title: "Catálogo" })} />);

    expect(markup).toMatch(/font-weight:800[^>]*>Catálogo</);
    expect(markup).not.toContain("font-size:54px");
  });

  it("keeps the title to two balanced lines at most", () => {
    const markup = html(<Cover {...cover()} />);

    expect(markup).toContain("text-wrap:balance");
    expect(markup).toContain("overflow-wrap:anywhere");
  });

  it("layers the logo with a screen blend so its black background drops out", () => {
    const markup = html(<Cover {...cover()} />);
    const [photo, logo] = imgs(markup);

    expect(photo.getAttribute("alt")).toBe("");
    expect(logo.getAttribute("alt")).toBe("Logo");
    expect(logo.getAttribute("style")).toContain("mix-blend-mode:screen");
    expect(photo.getAttribute("style")).not.toContain("mix-blend-mode");
  });

  it("uses the brand red for the rule", () => {
    expect(html(<Cover {...cover({ red: "#123456" })} />)).toContain("background:#123456");
  });

  it("with no photo falls back to a solid #0b0b0b sheet and renders no photo <img>", () => {
    const markup = html(<Cover {...cover({ coverImageUrl: null })} />);

    expect(imgs(markup).filter((img) => img.getAttribute("alt") === "")).toHaveLength(0);
    expect(markup).toContain("#0b0b0b");
    expect(imgs(markup)).toHaveLength(1); // the logo is still there
  });

  it("with no logo renders no logo <img> but keeps the photo", () => {
    const markup = html(<Cover {...cover({ logoUrl: null })} />);

    expect(imgs(markup).map((img) => img.getAttribute("alt"))).toEqual([""]);
  });

  it("omits the divider row when there is neither a workshop name nor cover text", () => {
    const withMeta = html(<Cover {...cover()} />);
    const without = html(<Cover {...cover({ workshopName: null, coverText: null })} />);

    expect(withMeta).toContain("DForce Car Audio");
    expect(withMeta).toContain("Catálogo de productos");
    expect(withMeta).toContain("border-top");
    expect(without).not.toContain("border-top");
  });

  it("keeps the divider when only one of the two is set", () => {
    const onlyName = html(<Cover {...cover({ coverText: null })} />);

    expect(onlyName).toContain("DForce Car Audio");
    expect(onlyName).toContain("border-top");
  });
});

describe("Back", () => {
  it("prints one labelled row per contact field it is given, and no others", () => {
    const markup = html(<Back {...back({ rows: back().rows.slice(0, 2) })} />);

    expect(markup).toContain("TELÉFONO");
    expect(markup).toContain("203-7212");
    expect(markup).toContain("WHATSAPP");
    expect(markup).not.toContain("CORREO");
    expect(markup).not.toContain("DIRECCIÓN");
  });

  it("draws a stroked icon in the brand red for each row", () => {
    const markup = html(<Back {...back({ red: "#123456" })} />);

    expect(count(markup, "<svg")).toBe(5);
    expect(markup).toContain('stroke="#123456"');
  });

  it("draws its icons as inline svg without calling into lucide-react, a client module on the server", () => {
    const rows: BackProps["rows"] = [...back().rows, { key: "website", label: "WEB", value: "dforce.com" }];
    const markup = html(<Back {...back({ rows })} />);

    expect(count(markup, "<svg")).toBe(6);
    expect(markup).toContain('d="M13.832 16.568'); // phone
    expect(markup).toContain('d="M2.992 16.342'); // message-circle
    expect(markup).toContain('d="m22 7-8.991 5.727'); // mail
    expect(markup).toContain('d="M12 6v6l4 2"'); // clock
    expect(markup).toContain('d="M20 10c0 4.993'); // map-pin
    expect(markup).toContain('d="M12 2a14.5 14.5'); // globe
  });

  it("gives email its own line, but pairs it with the website when both exist", () => {
    const email = { key: "email", label: "CORREO", value: "a@b.co" } as const;
    const website = { key: "website", label: "SITIO WEB", value: "dforce.example" } as const;

    expect(html(<Back {...back({ rows: [email] })} />)).toContain("grid-column:1 / -1");
    const paired = html(<Back {...back({ rows: [email, website] })} />);
    expect(paired).not.toContain("grid-column");
    expect(count(paired, "<svg")).toBe(2);
  });

  it("prints every social handle with its network name", () => {
    const markup = html(<Back {...back()} />);

    expect(markup).toContain("Instagram");
    expect(markup).toContain("@dforcecar");
    expect(markup).toContain("Facebook");
    expect(markup).toContain("D Force Car");
  });

  it("omits the social strip when there are no handles", () => {
    const markup = html(<Back {...back({ socials: [] })} />);

    expect(markup).not.toContain("Instagram");
    expect(markup).not.toContain("border-top");
  });

  it("closes with the red disclaimer band", () => {
    const markup = html(<Back {...back()} />);

    expect(markup).toContain("Precios sujetos a cambio sin previo aviso");
  });

  it("layers the logo with a screen blend over the photo strip", () => {
    const [photo, logo] = imgs(html(<Back {...back()} />));

    expect(photo.getAttribute("alt")).toBe("");
    expect(logo.getAttribute("style")).toContain("mix-blend-mode:screen");
  });

  it("with no photo renders no strip <img>", () => {
    const markup = html(<Back {...back({ coverImageUrl: null })} />);

    expect(imgs(markup).filter((img) => img.getAttribute("alt") === "")).toHaveLength(0);
    expect(imgs(markup)).toHaveLength(1);
  });

  it("with no logo renders no logo <img>", () => {
    expect(imgs(html(<Back {...back({ logoUrl: null })} />)).map((img) => img.getAttribute("alt"))).toEqual([""]);
  });
});
