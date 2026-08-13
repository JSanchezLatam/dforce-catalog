import type { ProductPrices as ProductPricesShape, ProductPrintRef } from "./CatalogTemplate";

type CardProps = {
  product: ProductPrintRef;
  style?: React.CSSProperties;
};

/**
 * Local, not imported from `catalog-builder`'s `PRICE_LIST_LABELS` — that
 * would invert the `shared ← modules` dependency direction (design D4), and
 * the card needs shorter labels than the generate-step selector did.
 */
const TIER_LABELS: Record<keyof ProductPricesShape, string> = {
  venta: "Venta",
  taller: "Taller",
  socio: "Socio",
};

/** Mockup card ink (`Template_Catalogo.op`, page "2 · Productos"). */
const CARD_BORDER = "#e6e6e6";
const CARD_TINT = "#f4f4f4";
const INK_MUTED = "#8f8f8f";
const RED = "#D42027";
/** Width of the image column. The rest of the card is the text column. */
const IMAGE_COLUMN_PX = 112;

/**
 * Design D4's em-dash rule, re-guarded at the render site even though
 * `resolvePrice` already maps a `0.00` ERP value to `null` upstream: a
 * hostile payload reaching the decoupled PDF worker must never be able to
 * print "$0.00" next to a product.
 */
function formatTier(value: number | null | undefined): string {
  if (value == null || value <= 0) return "—";
  return `$${value.toFixed(2)}`;
}

/**
 * The three-tier price table, as the mockup draws it: one row per tier, label
 * left in small caps, amount right. Venta — the headline price — is tinted and
 * printed in the brand red; the trade tiers stay black so a customer reading
 * the page cannot mistake which number is theirs.
 *
 * Always renders all three tiers, never fewer, even when every tier is absent
 * (each just shows an em-dash) — a card missing a row would read as a card
 * that does not offer that tier.
 */
function ProductPrices({ prices }: { prices?: ProductPricesShape | null }) {
  const tiers = Object.keys(TIER_LABELS) as (keyof ProductPricesShape)[];
  return (
    <div style={{ marginTop: "auto" }}>
      {tiers.map((tier, index) => (
        <div
          key={tier}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "5px 10px",
            background: index === 0 ? CARD_TINT : "transparent",
            borderTop: index === 0 ? "none" : `1px solid ${CARD_BORDER}`,
          }}
        >
          <span style={{ fontSize: 7, fontWeight: 800, letterSpacing: 1.6, color: INK_MUTED, textTransform: "uppercase" }}>
            {TIER_LABELS[tier]}
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, color: index === 0 ? RED : "#111111" }}>
            {formatTier(prices?.[tier])}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Category kicker, product name and ERP code — the card's text column head. */
function ProductHeading({ product }: { product: ProductPrintRef }) {
  return (
    <div style={{ padding: "12px 10px 8px" }}>
      {product.categoryL2 && (
        <p style={{ margin: 0, fontSize: 6.5, fontWeight: 800, letterSpacing: 1.4, color: RED, textTransform: "uppercase" }}>
          {product.categoryL2}
        </p>
      )}
      <p style={{ margin: "3px 0 0", fontSize: 11, fontWeight: 800, lineHeight: 1.25, textTransform: "uppercase" }}>
        {product.name}
      </p>
      <p style={{ margin: "3px 0 0", fontSize: 8, color: INK_MUTED }}>Cód. {product.id}</p>
    </div>
  );
}

/**
 * The image column. `fit` is the only thing that differs between the two card
 * kinds: a cut-out product fills its box without cropping (`contain`), a
 * photographed one is cropped to fill (`cover`). The placeholder keeps the
 * same footprint so a product without a photo does not resize its whole row.
 */
function ProductImage({ product, fit }: { product: ProductPrintRef; fit: "cover" | "contain" }) {
  return (
    <div style={{ width: IMAGE_COLUMN_PX, flexShrink: 0, background: CARD_TINT, overflow: "hidden" }}>
      {product.image ? (
        <img src={product.image} alt={product.name} style={{ width: "100%", height: "100%", objectFit: fit }} />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            minHeight: 150,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: INK_MUTED,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: 1.2,
            textAlign: "center",
          }}
        >
          SIN IMAGEN
        </div>
      )}
    </div>
  );
}

function ProductCard({ product, style, fit }: CardProps & { fit: "cover" | "contain" }) {
  return (
    <div
      style={{
        breakInside: "avoid",
        display: "flex",
        alignItems: "stretch",
        height: "100%",
        background: "#fff",
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 6,
        overflow: "hidden",
        ...style,
      }}
    >
      <ProductImage product={product} fit={fit} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <ProductHeading product={product} />
        <ProductPrices prices={product.prices} />
      </div>
    </div>
  );
}

/** Cut-out product shot — shown whole, never cropped. */
export function TransparentProductCard({ product, style }: CardProps) {
  return <ProductCard product={product} style={style} fit="contain" />;
}

/** Photographed product — cropped to fill its column. */
export function OpaqueProductCard({ product, style }: CardProps) {
  return <ProductCard product={product} style={style} fit="cover" />;
}
