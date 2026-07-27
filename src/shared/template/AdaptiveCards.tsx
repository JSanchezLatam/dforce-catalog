import type { ProductPrintRef } from "./CatalogTemplate";

type CardProps = {
  product: ProductPrintRef;
  style?: React.CSSProperties;
};

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
      </div>
    </div>
  );
}
