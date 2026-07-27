# Stack — Dforce Car Catalog Generation System

## Runtime / Framework

| Capa            | Tecnología                  | Para qué                                                    |
| --------------- | --------------------------- | ----------------------------------------------------------- |
| **Framework**   | Next.js 16.2 (App Router)   | Backend + frontend unificados. React 19, tipos compartidos. |
| **Output**      | `standalone`                | Un solo proceso Node persistente en Docker (no serverless). |

## Base de datos

| Capa          | Tecnología                        | Para qué                                             |
| ------------- | --------------------------------- | ---------------------------------------------------- |
| **DB**        | PostgreSQL 17 Alpine              | Única dependencia de datos.                          |
| **ORM**       | Drizzle ORM 0.45 + drizzle-kit    | Tipado fuerte, esquemas centralizados, migraciones.   |
| **Driver**    | `pg` 8.22                         | Driver nativo de Postgres.                           |
| **Queue**     | pg-boss 12.26                     | Cola de trabajos en la misma DB (sin Redis necesario). |

## Frontend

| Capa               | Tecnología                               | Para qué                                           |
| ------------------ | ---------------------------------------- | -------------------------------------------------- |
| **UI primitives**  | shadcn/ui + Base UI React 1.6            | Componentes headless accesibles (dialog, select…). |
| **Estilos**        | Tailwind CSS v4 + PostCSS                | Paleta `dash-*` v2.                                |
| **Iconos**         | lucide-react                             | Iconos livianos.                                   |
| **Utilidades**     | clsx, tailwind-merge, class-variance-authority | Composición de clases condicionales.         |

## Infraestructura

| Capa              | Tecnología                                     | Para qué                                          |
| ----------------- | ---------------------------------------------- | ------------------------------------------------- |
| **Contenedor**    | Docker multi-stage (Node 22 slim → Playwright) | Build optimizado, `.next/standalone` liviano.      |
| **Base imagen**   | `mcr.microsoft.com/playwright:v1.61.1-noble`   | Chromium + OS deps para renderizar PDFs.          |
| **Storage**       | AWS S3 SDK (R2-compatible)                     | Almacenamiento de PDFs en bucket S3/R2.           |

## Testing

| Capa               | Tecnología                | Para qué                                      |
| ------------------ | ------------------------- | --------------------------------------------- |
| **Unit/integration** | Vitest 4.1              | 115 tests de módulos, rutas API, lógica.      |
| **E2E**            | Vitest + Playwright       | Flujo completo: login → sync → builder → PDF. |
| **Linting**        | ESLint 9 + next/core-web-vitals | Código consistente.                     |

---

## Estructura del proyecto

```
src/
├── app/                          # Next.js App Router
│   ├── api/                      # Route Handlers (backend)
│   │   ├── login/                #   POST — autenticar usuario
│   │   ├── logout/               #   POST — cerrar sesión
│   │   ├── template-config/      #   GET/PUT — branding (logo, colores)
│   │   ├── inventory-sync/manual/#   GET/POST — status y trigger de sync
│   │   ├── catalog-builder/      #   products, queue-depth, generate
│   │   └── catalogs/[id]/        #   GET  — descargar PDF
│   ├── (app)/                    # Layout autenticado (sidebar + header)
│   │   ├── inventory/            #   Productos sincronizados (filtros, paginación)
│   │   ├── builder/              #   Constructor de catálogos
│   │   ├── catalogs/             #   Listado de catálogos generados
│   │   └── template-config/      #   Configuración de marca
│   ├── login/                    # Página pública de login
│   ├── globals.css               # Estilos globales Tailwind v4
│   └── layout.tsx                # Root layout (sin sidebar)
│
├── modules/                      # 8 módulos independientes (hexagonal)
│   ├── auth/                     # Autenticación
│   │   ├── actions.ts            #   Server Action de login
│   │   ├── authenticate.ts       #   Lógica de autenticación
│   │   ├── session.ts            #   Sesiones DB (opaque token, no JWT)
│   │   ├── password.ts           #   bcrypt cost >= 12
│   │   ├── policy.ts             #   Permisos: can(user, "sync.manual")
│   │   └── LoginForm.tsx         #   Componente cliente de login
│   │
│   ├── inventory-sync/           # Sincronización con Interfuerza
│   │   ├── client.ts             #   Cliente HTTP contra API Interfuerza v4
│   │   ├── mapper.ts             #   Mapeo de campos API → DB
│   │   ├── job.ts                #   Worker pg-boss que orquesta la sync
│   │   └── ManualSyncButton.tsx  #   Botón de sync manual (admin only)
│   │
│   ├── inventory-view/           # Consulta de productos
│   │   ├── queries.ts            #   Listado paginado + filtros por categoría
│   │   ├── InventoryFilters.tsx  #   Filtros UI
│   │   └── InventoryStatsHeader.tsx # Header con estadísticas
│   │
│   ├── template-config/          # Configuración de marca PDF
│   │   ├── service.ts            #   CRUD de template_config
│   │   └── TemplateConfigForm.tsx #   Formulario (logo, colores, tipografía)
│   │
│   ├── catalog-builder/          # Constructor de catálogos
│   │   ├── selection.ts          #   Lógica de selección de productos
│   │   ├── queries.ts            #   Consultas de categorías
│   │   ├── CatalogBuilderForm.tsx #   Formulario principal
│   │   ├── TreeSelect.tsx        #   Selector jerárquico de categorías
│   │   ├── ImagePreviewDialog.tsx #   Preview de imagen en modal
│   │   └── ConfirmGenerateDialog.tsx # Confirmación antes de generar
│   │
│   ├── pdf-generation/           # Generación de PDFs (worker)
│   │   ├── render.ts             #   Renderiza React component → PDF (Playwright)
│   │   ├── worker.ts             #   Worker pg-boss que orquesta render+handoff
│   │   ├── enqueue.ts            #   Encola trabajo de generación
│   │   └── position.ts           #   Cola de posición (fairness entre usuarios)
│   │
│   ├── catalog-storage/          # Almacenamiento + retención
│   │   ├── r2.ts                 #   Cliente S3/R2
│   │   ├── retention.ts          #   Política de retención (borra más viejos)
│   │   ├── upload-status.ts      #   Worker que trackea upload pending→uploading→done
│   │   ├── queries.ts            #   Consultas de catálogos por usuario
│   │   └── CatalogGrid.tsx       #   Grid de catálogos generados
│   │
│   └── layout/                   # Sidebar + navegación
│       ├── nav-items.ts          #   Definición de ítems de navegación
│       ├── LogoutButton.tsx      #   Botón de cerrar sesión
│       └── app-sidebar.tsx       #   Sidebar 72px icon-only rail
│
├── shared/                       # Código compartido entre módulos
│   ├── config/env.ts             # Variables de entorno tipadas
│   ├── db/
│   │   ├── schema.ts             #   Esquema Drizzle (6 tablas)
│   │   ├── client.ts             #   Pool de conexión PostgreSQL
│   │   └── migrations/           #   Migraciones versionadas
│   ├── jobs/boss.ts              #   Cliente pg-boss compartido
│   ├── template/
│   │   └── CatalogTemplate.tsx   #   Componente React para render PDF
│   └── ui/
│       ├── Toast.tsx             #   Sistema de notificaciones toast
│       ├── ToastProvider.tsx     #   Provider del toast
│       ├── Pagination.tsx        #   Paginación client-side
│       ├── StatusBadge.tsx       #   Badge de estado (running/completed/failed)
│       ├── LazyImage.tsx         #   Imagen lazy con skeleton
│       └── styles.ts             #   Constantes de estilo compartidas
│
└── components/ui/                # Componentes shadcn/ui regenerados
    ├── button.tsx, card.tsx, dialog.tsx, select.tsx, table.tsx,
    ├── badge.tsx, skeleton.tsx, input.tsx, label.tsx,
    ├── sidebar.tsx, sheet.tsx, tooltip.tsx, avatar.tsx,
    ├── dropdown-menu.tsx, separator.tsx, breadcrumb.tsx, checkbox.tsx
```

---

## Módulos y responsabilidades

### 1. `auth` — Autenticación

Login con usuario/contraseña, sesiones en DB con token opaco (no JWT), bcrypt con
costo ≥ 12, y permisos granulares vía `can(user, permission)`. Dos roles:
`usuario` (lectura) y `administrador` (acciones: sync manual, configurar marca,
generar etc.).

### 2. `inventory-sync` — Sincronización con Interfuerza

Se conecta a la API REST de Interfuerza (POST con `{class:"GET",
action:"products"}`), mapea los campos del JSON real al schema, y hace upsert
batch en `producto`. Tiene botón manual para administradores con polling de
estado cada 2s, más un worker automático en pg-boss.

### 3. `inventory-view` — Consulta de productos

Lista paginada con filtros por categoría L1/L2 y búsqueda por nombre. Cualquier
usuario autenticado puede ver el inventario sincronizado. Incluye header con
estadísticas (total productos, última sincronización).

### 4. `template-config` — Configuración de marca

Registro único en DB (`singleton-row-no-history`) con: URL del logo, colores
primario/secundario, tipografía y texto de portada. Solo administradores pueden
modificarlo. Persiste entre reinicios.

### 5. `catalog-builder` — Constructor de catálogos

El usuario selecciona categorías de productos, el sistema muestra una tabla con
previsualización de imágenes, selector jerárquico TreeSelect, y un preview del
catálogo en vivo. Antes de generar confirma con un dialog y verifica la cola.
Al generar, encola un trabajo en pg-boss y muestra advertencia de retención si
corresponde.

### 6. `pdf-generation` — Generación de PDFs

Worker que escucha la cola de pg-boss. Renderiza un componente React como PDF
usando Playwright (Chromium headless). Usa advisory locks de Postgres para
control de concurrencia (profundidad máxima) y cola de posición para fairness
entre usuarios.

### 7. `catalog-storage` — Almacenamiento + retención

Sube el PDF generado a un bucket S3/R2, trackea el estado (pending → uploading
→ uploaded/failed), y aplica retención automática (borra el más viejo al
alcanzar el límite). Incluye un provider de polling que refresca la lista de
catálogos cada 5s mientras hay trabajos en progreso.

### 8. `layout` — Sidebar + navegación

Sidebar 72px icon-only rail con tooltips, breadcrumbs, y navegación entre
secciones. Incluye indicador de sesión y botón de logout.

---

## APIs expuestas

| Ruta                                    | Método     | Auth            | Para qué                                |
| --------------------------------------- | ---------- | --------------- | --------------------------------------- |
| `/api/login`                            | POST       | pública         | Iniciar sesión (creates session cookie) |
| `/api/logout`                           | POST       | session cookie  | Cerrar sesión (revoca token)            |
| `/api/template-config`                  | GET        | session cookie  | Leer configuración de marca             |
| `/api/template-config`                  | PUT        | admin           | Actualizar branding                     |
| `/api/inventory-sync/manual`            | GET        | session cookie  | Estado de la última sincronización      |
| `/api/inventory-sync/manual`            | POST       | admin           | Disparar sincronización manual          |
| `/api/catalog-builder/products`         | GET        | session cookie  | Productos filtrados por categoría       |
| `/api/catalog-builder/queue-depth`      | GET        | session cookie  | Profundidad actual de la cola           |
| `/api/catalog-builder/generate`         | POST       | session cookie  | Encolar generación de catálogo          |
| `/api/catalogs/[id]`                    | GET        | session cookie  | Descargar PDF (solo dueño)              |

---

## Tablas en DB (PostgreSQL)

| Tabla             | Propósito                                               |
| ----------------- | ------------------------------------------------------- |
| `users`           | Usuarios del sistema (username, password_hash, role)    |
| `sessions`        | Sesiones activas (opaque token, expires_at, revoked_at) |
| `producto`        | Productos sincronizados desde Interfuerza               |
| `sync_runs`       | Auditoría de sincronizaciones                           |
| `template_config` | Configuración de branding (singleton row)               |
| `catalogs`        | Catálogos generados (trackea estado upload a R2)        |

---

## Scripts disponibles

| Comando               | Para qué                                    |
| --------------------- | ------------------------------------------- |
| `npm run dev`         | Desarrollo con hot reload                   |
| `npm run build`       | Build production (Next standalone)          |
| `npm run start`       | Iniciar servidor production                 |
| `npm run test`        | Tests unitarios/integración (Vitest)        |
| `npm run test:e2e`    | Tests end-to-end (Playwright)               |
| `npm run lint`        | ESLint                                      |
| `npm run db:generate` | Generar migración Drizzle                   |
| `npm run db:migrate`  | Correr migraciones pendientes               |
| `npm run db:studio`   | Drizzle Studio (explorador DB)              |
| `npm run db:seed-user`| Crear usuario inicial (script Node)         |
| `docker compose up`   | App + Postgres + workers                    |
| `docker compose run --rm migrate` | Correr migraciones en Docker     |
