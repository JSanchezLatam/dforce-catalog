/* eslint-disable @next/next/no-img-element --
   This markup is also rendered by renderToStaticMarkup for Playwright, with
   data: URIs; next/image needs a Next runtime and a loader for neither. */
import type { BackProps, CatalogTemplateDef, ContactRowKey, CoverProps } from "../registry-types";
import { dforceClassic } from "./dforce-classic";

/**
 * "Portada completa" — a full-bleed photo cover and a contact sheet to match,
 * translated from `openspec/changes/catalog-cover-templates/mockup/cover-and-back.html`
 * (816x1056 sheets). It reuses Clásico's interior pages untouched: only the
 * cover and the contact sheet differ, and the two seams below return CONTENT
 * only — `CatalogTemplate` owns the `<Sheet>` wrappers.
 *
 * Saira is set inline inside the seams and nowhere else, so interior pages stay
 * Arial. The faces come from `fonts/saira.css` (data URIs in the PDF worker,
 * the bundler in the preview).
 */
const NIGHT = "#0b0b0b";
const DISPLAY = '"Saira Condensed", "Arial Narrow", sans-serif';
const TEXT = '"Saira", Arial, sans-serif';
const INK_SOFT = "rgba(255,255,255,0.78)";
const INK_FAINT = "#9c9c9c";

/** Title sizes: the mockup's 118px fits ~12 glyphs per line over the 688px block. */
const TITLE_SIZE_LARGE_PX = 118;
const TITLE_SIZE_MEDIUM_PX = 84;
const TITLE_SIZE_SMALL_PX = 64;
const LARGE_MAX_CHARS = 12;
const MEDIUM_MAX_CHARS = 24;

const FULL_BLEED: React.CSSProperties = { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" };

/** `Catálogo: X` → light lead line + heavy main line; no `": "` → all main. */
export function splitTitle(title: string): { lead: string | null; main: string } {
  const at = title.indexOf(": ");
  if (at === -1) return { lead: null, main: title };
  return { lead: title.slice(0, at + 1), main: title.slice(at + 2) };
}

/** Steps the main line down so a typed title (max 40 chars) stays within two lines. */
export function titleSize(main: string): number {
  if (main.length <= LARGE_MAX_CHARS) return TITLE_SIZE_LARGE_PX;
  if (main.length <= MEDIUM_MAX_CHARS) return TITLE_SIZE_MEDIUM_PX;
  return TITLE_SIZE_SMALL_PX;
}

function Cover({ title, logoUrl, coverImageUrl, workshopName, coverText, red }: CoverProps) {
  const { lead, main } = splitTitle(title);
  return (
    <>
      <div style={{ ...FULL_BLEED, background: NIGHT }} />
      {coverImageUrl && (
        <>
          <img src={coverImageUrl} alt="" style={{ ...FULL_BLEED, objectFit: "cover" }} />
          <div
            style={{
              ...FULL_BLEED,
              background:
                "linear-gradient(to top, rgba(0,0,0,.9) 0%, rgba(0,0,0,.6) 32%, rgba(0,0,0,.08) 58%, rgba(0,0,0,.92) 80%, #000 100%)",
            }}
          />
        </>
      )}
      {/* The workshop's logo is a JPEG on a black background: `screen` drops the
          black against the near-black top of the overlay, so it reads solid. */}
      {logoUrl && <img src={logoUrl} alt="Logo" style={{ position: "absolute", top: 48, left: 48, width: 300, mixBlendMode: "screen" }} />}
      <div style={{ position: "absolute", left: 64, right: 64, bottom: 72, color: "#fff", fontFamily: TEXT }}>
        <div style={{ width: 64, height: 6, background: red, marginBottom: 28 }} />
        <h1 style={{ margin: 0, fontFamily: DISPLAY, textTransform: "uppercase", lineHeight: 0.9, letterSpacing: "-0.01em" }}>
          {lead && (
            <span style={{ display: "block", fontWeight: 400, color: INK_SOFT, letterSpacing: "0.01em", fontSize: 54 }}>{lead}</span>
          )}
          <span style={{ display: "block", fontWeight: 800, textWrap: "balance", overflowWrap: "anywhere", fontSize: titleSize(main) }}>
            {main}
          </span>
        </h1>
        {(workshopName || coverText) && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginTop: 30,
              paddingTop: 18,
              borderTop: "1px solid rgba(255,255,255,.22)",
            }}
          >
            {workshopName && (
              <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 22, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {workshopName}
              </span>
            )}
            {coverText && <span style={{ marginLeft: "auto", fontSize: 15, color: INK_SOFT }}>{coverText}</span>}
          </div>
        )}
      </div>
    </>
  );
}

/*
 * lucide's path data, drawn as plain <svg>. NOT lucide-react: it is a
 * "use client" module, and the pdf-generate worker renders this inside the Next
 * server graph, where calling a client component throws.
 */
const ROW_ICONS: Record<ContactRowKey, React.ReactNode> = {
  phone: (
    <path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />
  ),
  whatsapp: (
    <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
  ),
  email: (
    <>
      <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
      <rect x="2" y="4" width="20" height="16" rx="2" />
    </>
  ),
  hours: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  address: (
    <>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  website: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </>
  ),
};

/** Phone and WhatsApp share the first line; the rest take a whole line unless email and website pair up. */
function isWide(key: ContactRowKey, rows: BackProps["rows"]): boolean {
  if (key === "phone" || key === "whatsapp") return false;
  if (key === "email" || key === "website") return !(rows.some((r) => r.key === "email") && rows.some((r) => r.key === "website"));
  return true;
}

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: DISPLAY,
  fontWeight: 600,
  fontSize: 15,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: INK_FAINT,
};

function Back({ rows, socials, logoUrl, coverImageUrl, red }: BackProps) {
  return (
    <>
      <div style={{ ...FULL_BLEED, background: NIGHT }} />
      {coverImageUrl && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 470, overflow: "hidden" }}>
          <img src={coverImageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 70%" }} />
          <div
            style={{
              ...FULL_BLEED,
              background:
                "linear-gradient(to bottom, rgba(0,0,0,.25) 0%, rgba(11,11,11,.55) 30%, rgba(11,11,11,.96) 62%, #0b0b0b 100%)",
            }}
          />
        </div>
      )}
      {logoUrl && (
        <img
          src={logoUrl}
          alt="Logo"
          style={{ position: "absolute", top: 250, left: "50%", width: 340, transform: "translateX(-50%)", mixBlendMode: "screen" }}
        />
      )}
      <div style={{ position: "absolute", left: 72, right: 72, top: 470, color: "#fff", fontFamily: TEXT }}>
        <h2 style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 800, fontSize: 64, lineHeight: 1, textTransform: "uppercase" }}>Contacto</h2>
        <div style={{ width: 64, height: 6, background: red, marginTop: 18, marginBottom: 34 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 48, rowGap: 26 }}>
          {rows.map((row) => {
            return (
              <div
                key={row.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "40px 1fr",
                  columnGap: 16,
                  alignItems: "start",
                  minWidth: 0,
                  ...(isWide(row.key, rows) ? { gridColumn: "1 / -1" } : {}),
                }}
              >
                <svg
                  width={26}
                  height={26}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={red}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ marginTop: 4 }}
                >
                  {ROW_ICONS[row.key]}
                </svg>
                <div style={{ minWidth: 0 }}>
                  <div style={LABEL_STYLE}>{row.label}</div>
                  <div style={{ marginTop: 4, fontSize: 22, fontWeight: 500, lineHeight: 1.3, overflowWrap: "anywhere" }}>{row.value}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {socials.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: 72,
            right: 72,
            bottom: 96,
            display: "flex",
            gap: 40,
            paddingTop: 22,
            borderTop: "1px solid rgba(255,255,255,.18)",
            color: "#fff",
            fontFamily: TEXT,
          }}
        >
          {socials.map(([platform, handle]) => (
            <span key={platform} style={{ fontSize: 19, fontWeight: 500 }}>
              <b style={{ ...LABEL_STYLE, marginRight: 10 }}>{platform}</b>
              {handle}
            </span>
          ))}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 52,
          background: red,
          color: "#fff",
          fontFamily: TEXT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          fontWeight: 500,
          letterSpacing: "0.02em",
        }}
      >
        Precios sujetos a cambio sin previo aviso
      </div>
    </>
  );
}

export { Back, Cover };

export const fullCover: CatalogTemplateDef = {
  ...dforceClassic,
  id: "full-cover",
  name: "Portada completa",
  Cover,
  Back,
};
