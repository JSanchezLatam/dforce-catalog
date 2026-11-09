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

const MATCHERS = Object.entries(SCREEN_LABELS).map(
  ([pattern, label]) => [new RegExp(`^${pattern.replace(/\[[^\]]+\]/g, "[^/]+")}$`), label] as const,
);

/** The pathname alone: no query string, no fragment. */
export function routeOf(path: string): string {
  return path.split(/[?#]/)[0];
}

/** Unmapped routes fall back to the raw route, so a new page never breaks a send. */
export function screenLabelFor(path: string): string {
  const route = routeOf(path);
  const normalized = route.length > 1 ? route.replace(/\/+$/, "") : route;
  return MATCHERS.find(([re]) => re.test(normalized))?.[1] ?? route;
}
