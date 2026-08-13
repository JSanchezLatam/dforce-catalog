import type { ProductPrices as ProductPricesShape, ProductPrintRef } from "./CatalogTemplate";

/**
 * `colors` comes from the registry entry that renders the card (design D1/D2 —
 * "font/colours/card markup live in the code registry, keyed by templateId").
 * It is not optional and has no default: the whole point of the registry is
 * that a second template cannot be half-rebranded, and a card that falls back
 * to DForce red when a caller forgets is exactly that failure, silently.
 */
type CardProps = {
  product: ProductPrintRef;
  colors: { primary: string; secondary: string };
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
function ProductPrices({ prices, colors }: { prices?: ProductPricesShape | null; colors: CardProps["colors"] }) {
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
          <span style={{ fontSize: 12, fontWeight: 800, color: index === 0 ? colors.primary : colors.secondary }}>
            {formatTier(prices?.[tier])}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Category kicker, product name and ERP code — the card's text column head. */
function ProductHeading({ product, colors }: { product: ProductPrintRef; colors: CardProps["colors"] }) {
  return (
    <div style={{ padding: "12px 10px 8px" }}>
      {product.categoryL2 && (
        <p style={{ margin: 0, fontSize: 6.5, fontWeight: 800, letterSpacing: 1.4, color: colors.primary, textTransform: "uppercase" }}>
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
 * photographed one is cropped to fill (`cover`).
 *
 * The placeholder needs no height of its own. The card is a flex row with
 * `align-items: stretch`, so this column is already as tall as the text column
 * beside it — a `min-height` here would be a FLOOR, not a match, and a floor
 * taller than the text column makes the photo-less card the tallest in its
 * row and drags its neighbour up with it. Exactly backwards.
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

function ProductCard({ product, colors, style, fit }: CardProps & { fit: "cover" | "contain" }) {
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
        <ProductHeading product={product} colors={colors} />
        <ProductPrices prices={product.prices} colors={colors} />
      </div>
    </div>
  );
}

/** Cut-out product shot — shown whole, never cropped. */
export function TransparentProductCard({ product, colors, style }: CardProps) {
  return <ProductCard product={product} colors={colors} style={style} fit="contain" />;
}

/** Photographed product — cropped to fill its column. */
export function OpaqueProductCard({ product, colors, style }: CardProps) {
  return <ProductCard product={product} colors={colors} style={style} fit="cover" />;
}
