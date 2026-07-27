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
type PriceListEntry = { Price?: string | number; ListName?: string };

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSessionFromHeaders();
  if (!can(user, "inventory.read")) {
    return <div className="p-8"><p className="text-sm text-foreground">You do not have permission to view this page.</p></div>;
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
            <BreadcrumbLink render={<Link href="/inventory" />}>Inventory</BreadcrumbLink>
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
                    {product.stock} in stock
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                {field("ID", product.id)}
                {field("Category L1", product.categoryL1)}
                {field("Category L2", product.categoryL2)}
                {field("Price", product.price != null ? `$${product.price.toFixed(2)}` : null)}
                {field("Code", p?.Codigo)}
                {field("Brand", p?.Marca)}
                {field("Description", p?.Descripcion)}
              </dl>
            </CardContent>
          </Card>

          {priceLists.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Price Lists</CardTitle>
              </CardHeader>
              <CardContent>
                <dl>
                  {priceLists.map((pl, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-0">
                      <dt className="text-sm font-medium text-muted-foreground">{pl.ListName ?? `List ${i + 1}`}</dt>
                      <dd className="col-span-2 text-sm text-foreground">
                        {pl.Price != null ? `$${Number(pl.Price).toFixed(2)}` : "—"}
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
                <CardTitle>Stock by Warehouse</CardTitle>
              </CardHeader>
              <CardContent>
                <dl>
                  {inStock.map((row, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 py-2 border-b border-border last:border-0">
                      <dt className="text-sm font-medium text-muted-foreground">Warehouse {i + 1}</dt>
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
                <CardTitle>Matrix Data</CardTitle>
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
                <CardTitle>Images</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {images.map((img, i) =>
                  img.src ? (
                    <LazyImage
                      key={i}
                      src={img.src}
                      alt={`${product.name} — image ${i + 1}`}
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
