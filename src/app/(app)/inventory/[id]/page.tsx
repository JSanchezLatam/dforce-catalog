import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

import { getProductById } from "@/modules/inventory-view/queries";
import { LazyImage } from "@/shared/ui/LazyImage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

type ProductImage = { src?: string };
/**
 * The ERP's shape, verified against all 699 products — NOT `{ListName, Price}`,
 * which is what this page used to read and why the card rendered blank.
 *
 * `Name` carries trailing whitespace ("PRECIO TALLER ") and `Precio` is the
 * field to show, not `Precio_Real`: they disagree on 37 of those products (95 of the 2097 price-list
 * entries) and
 * `Precio_Real` is "0.00" in every one of those. Both rules are the same ones
 * `src/modules/catalog-builder/price-lists.ts` documents and follows.
 */
type PriceListEntry = { Name?: string; Precio?: string | number };

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSessionFromHeaders();
  if (!can(user, "inventory.read")) {
    return <div className="p-8"><p className="text-sm text-foreground">No tenés permiso para ver esta página.</p></div>;
  }

  const product = await getProductById(id);

  if (!product) notFound();

  const raw = product.raw;
  const p = raw.Producto as Record<string, unknown> | undefined;
  const images = (raw.Images as ProductImage[] | undefined) ?? [];
  const priceLists = (raw.PriceLists as PriceListEntry[] | undefined) ?? [];
  const inStock = raw.InStock as Array<Record<string, unknown>> | undefined;

  function field(label: string, value: unknown) {
    if (value == null || value === "") return null;
    return (
      <div className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-0">
        <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
        <dd className="col-span-2 text-sm text-foreground">{String(value)}</dd>
      </div>
    );
  }

  return (
    <div className="p-8">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/inventory" />}>Inventario</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{product.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                {product.name}
                {product.stock != null && (
                  <Badge variant={product.stock > 0 ? "default" : "destructive"}>
                    {product.stock} en stock
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                {field("ID", product.id)}
                {field("Categoría 1", product.categoryL1)}
                {field("Categoría 2", product.categoryL2)}
                {field("Precio", product.price != null ? `$${product.price.toFixed(2)}` : null)}
                {field("Código", p?.Codigo)}
                {field("Marca", p?.Marca)}
                {field("Descripción", p?.Descripcion)}
              </dl>
            </CardContent>
          </Card>

          {priceLists.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Listas de precios</CardTitle>
              </CardHeader>
              <CardContent>
                <dl>
                  {priceLists.map((pl, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-0">
                      <dt className="text-sm font-medium text-muted-foreground">{pl.Name?.trim() || `Lista ${i + 1}`}</dt>
                      <dd className="col-span-2 text-sm text-foreground">
                        {pl.Precio != null ? `$${Number(pl.Precio).toFixed(2)}` : "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}

          {inStock && inStock.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Stock por depósito</CardTitle>
              </CardHeader>
              <CardContent>
                <dl>
                  {inStock.map((row, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-0">
                      <dt className="text-sm font-medium text-muted-foreground">Depósito {i + 1}</dt>
                      <dd className="col-span-2 text-sm text-foreground">
                        {String(row.Available ?? "—")}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}

          {raw.Matrix != null && Array.isArray(raw.Matrix) && raw.Matrix.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Datos de matriz</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-4 text-xs text-foreground whitespace-pre-wrap font-mono">
                  {JSON.stringify(raw.Matrix, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {images.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Imágenes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {images.map((img, i) =>
                  img.src ? (
                    <LazyImage
                      key={i}
                      src={img.src}
                      alt={`${product.name} — imagen ${i + 1}`}
                      className="aspect-square w-full rounded-lg"
                    />
                  ) : null,
                )}
              </CardContent>
            </Card>
          )}

        </div>
      </div>
    </div>
  );
}
