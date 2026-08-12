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
 * Shared by both cards so a transparent product and a framed one never format
 * money differently on the same page. Always renders all three tiers, bold —
 * never fewer, even when every tier is absent (each just shows an em-dash).
 */
function ProductPrices({ prices }: { prices?: ProductPricesShape | null }) {
  return (
    <div style={{ margin: "2px 0 0" }}>
      {(Object.keys(TIER_LABELS) as (keyof ProductPricesShape)[]).map((tier) => (
        <p key={tier} style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
          {TIER_LABELS[tier]}: {formatTier(prices?.[tier])}
        </p>
      ))}
    </div>
  );
}

export function TransparentProductCard({ product, style }: CardProps) {
  return (
    <div
      style={{
        breakInside: "avoid",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {product.image ? (
        <img
          src={product.image}
          alt={product.name}
          style={{ width: "100%", height: 180, objectFit: "cover" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: 180,
            background: "#f3f4f6",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#9ca3af",
            fontSize: 14,
          }}
        >
          No image
        </div>
      )}
      <div style={{ padding: "0.5rem 0" }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{product.name}</p>
        {product.categoryL1 && (
          <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>
            {product.categoryL1}{product.categoryL2 ? ` / ${product.categoryL2}` : ""}
          </p>
        )}
        <ProductPrices prices={product.prices} />
      </div>
    </div>
  );
}

export function OpaqueProductCard({ product, style }: CardProps) {
  return (
    <div
      style={{
        breakInside: "avoid",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 8,
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        ...style,
      }}
    >
      {product.image ? (
        <img
          src={product.image}
          alt={product.name}
          style={{ width: "100%", height: 160, objectFit: "contain" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: 160,
            background: "#f9fafb",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#9ca3af",
            fontSize: 14,
          }}
        >
          No image
        </div>
      )}
      <div style={{ padding: "0.5rem 0.25rem" }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{product.name}</p>
        {product.categoryL1 && (
          <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>
            {product.categoryL1}{product.categoryL2 ? ` / ${product.categoryL2}` : ""}
          </p>
        )}
        <ProductPrices prices={product.prices} />
      </div>
    </div>
  );
}
