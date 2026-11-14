/** Route pattern (as the `(app)` folder tree spells it) to the Spanish screen name. */
export const SCREEN_LABELS: Record<string, string> = {
  "/account": "Mi cuenta",
  "/agenda": "Agenda",
  "/builder": "Generar Catálogos",
  "/catalogs": "Catálogos Generados",
  "/customers": "Clientes",
  "/customers/[id]": "Cliente — Detalle",
  "/customers/[id]/vehicles/[vehicleId]": "Vehículo — Detalle",
  "/inventory": "Inventario",
  "/inventory/[id]": "Inventario — Detalle",
  "/kanban": "Órdenes en curso",
  "/metrics": "Métricas",
  "/mis-numeros": "Mis números",
  "/service-orders": "Órdenes de servicio",
  "/service-orders/[id]": "Orden de servicio — Detalle",
  "/service-orders/[id]/print": "Orden de servicio — Hoja impresa",
  "/technicians": "Técnicos",
  "/template-config": "Configuración de plantillas",
  "/users": "Gestión de usuarios",
  "/vencimientos": "Vencimientos",
  "/workshop-config": "Config. del CRM",
};

const MATCHERS = Object.keys(SCREEN_LABELS).map(
  (pattern) => [new RegExp(`^${pattern.replace(/\[[^\]]+\]/g, "[^/]+")}$`), pattern] as const,
);

/** The pathname alone: no query string, no fragment. */
export function routeOf(path: string): string {
  return path.split(/[?#]/)[0];
}

/** The `SCREEN_LABELS` key a concrete path belongs to (`/service-orders/a` → `/service-orders/[id]`), or null. */
export function patternOf(path: string): string | null {
  const route = routeOf(path);
  const normalized = route.length > 1 ? route.replace(/\/+$/, "") : route;
  return MATCHERS.find(([re]) => re.test(normalized))?.[1] ?? null;
}

/** Unmapped routes fall back to the raw route, so a new page never breaks a send. */
export function screenLabelFor(path: string): string {
  const pattern = patternOf(path);
  return pattern === null ? routeOf(path) : SCREEN_LABELS[pattern];
}
