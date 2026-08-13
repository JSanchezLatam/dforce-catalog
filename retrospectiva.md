# Retrospectiva — traspaso a la próxima sesión

Fecha: 2026-08-13 · Rama: `main` en `fdb6d8d` · Tests 805/805 · `tsc` limpio · lint 0 errores

---

## Lo primero que tenés que saber

**El diseño del mockup nunca se implementó.** El owner generó un catálogo real y no se parece a lo que aprobó en OpenPencil.

Lo que se construyó en cinco unidades de trabajo fue la **fontanería**: el registro de plantillas, el reparto del branding, el flujo de datos, los tres niveles de precio, la página de contacto y la portada. El **aspecto**, no.

Esto no es una sospecha. Está verificado reproduciendo el render con los datos reales de la base.

### Evidencia

El índice produce esto, literal:

```html
<section aria-label="Index"><h2>Index</h2><ul><li>ACCESORIOS (6)</li></ul></section>
```

Un `<h2>` y viñetas. En inglés. Sin banda roja, sin tabla, sin números de página.

Las tarjetas de producto usan `#6b7280`, `#9ca3af`, `#e5e7eb`, `#f3f4f6`, `#f9fafb` — grises genéricos, ni un color de DForce.

El rojo y el negro de `template.primaryColors` solo se aplican en dos lugares de `CatalogTemplate.tsx`: la sección `Cover` (línea ~158) y la sección `Contact` (línea ~270). El índice y las tarjetas no los tocan.

### Por qué pasó

`src/shared/template/templates/dforce-classic.tsx` guarda tres cosas: tipografía, dos colores y un envoltorio de tarjeta. Su propio docstring dice que "el layout completo que describe el mockup es trabajo de `CatalogTemplate`, no de este archivo — WU3 tarea 3.2".

Pero la tarea 3.2 solo pedía que `CatalogTemplate` llamara a `getTemplate()` para la fuente y los colores. **Nunca existió una tarea de "traducir el índice del mockup" ni "rediseñar las tarjetas".**

Es el mismo fallo que tuvo el bloque de contacto, que `sdd-verify` sí atrapó: nadie falló en hacer el trabajo, el trabajo nunca se pidió. Y el orquestador no lo detectó porque estuvo verificando cañerías, no apariencia.

> **La lección, para no repetirla:** ningún test unitario del repo mira cómo se ve algo. Afirman estructura (`<img>` existe, `src` existe) y pasan con el resultado visualmente roto. Dos bugs de esta sesión lo demostraron. Cualquier trabajo de apariencia necesita render real + inspección visual como puerta, no como extra.

---

## Pendiente 1 — traducir el mockup (lo grande)

Fuentes de verdad, ambas aprobadas por el owner:

| Qué | Dónde |
|---|---|
| Portada | `Insumos/Templates/Portada_DForce_v1.html` — HTML/CSS real, renderizado por el mismo Chromium. Es un objetivo de traducción, no una maqueta a interpretar. |
| Índice, productos, contacto | `Insumos/Templates/Template_Catalogo.op` — páginas `1 · Índice`, `2 · Productos`, `3 · Contacto y redes` |

En el `.op`, **cada capa con dato dinámico lleva el nombre de su columna**: `Valor · workshop_config.phone`, `04.2.1 - Instagram · socialHandles.instagram`. No hay que adivinar bindings.

Lo que falta construir:

- **Portada a hoja completa.** Hoy mide `minHeight: 540` cuando la carta son 1056px.
- **Índice como tabla**: banda roja de encabezado, filas con categoría, cantidad y número de página, franja negra abajo. Y en español.
- **Tarjetas de producto con identidad DForce**, con su tabla de tres precios integrada al diseño, no filas sueltas.

### Bug a arreglar en la misma pasada

Sin foto de portada, el fondo es `black` **y la cuña diagonal también es `black`**. Negro sobre negro: invisible. Se ve una página negra con una raya roja.

Es la misma familia que el bug del `mix-blend-mode: multiply` contra negro. **Un color de respaldo que coincide con el color del elemento que debería contrastar contra él es invisible, y ningún test estructural lo ve.**

---

## Pendiente 2 — decisiones de producto abiertas

- **`DEFAULT_PRODUCTS_PER_PAGE` sigue en 6.** Se bajó de 10 a 6 cuando la cuenta tenía que coincidir con la realidad física. Desde que la paginación mide altura real, esa razón desapareció: el máximo ya no puede desbordar. Subirlo es decisión del owner.
- **Cargar los datos del taller.** `workshop_config` tiene teléfono, whatsapp, correo, dirección, horario, web y redes **todos vacíos**, y `cover_image_r2_key` también. Por eso el catálogo sale sin página de contacto y sin foto de portada. **No es un bug** — se construyó para omitir en vez de imprimir etiquetas huérfanas. Se cargan en Ajustes › Taller.

---

## Pendiente 3 — deuda técnica registrada

- **Flakiness intermitente de la suite.** Timeouts en `bcrypt`, `app-sidebar`, `UserForm`, `WorkshopConfigForm` justo después de procesos pesados de Playwright o GGA. No se reproduce aislado (tres corridas seguidas dieron 805/805). Archivos que el trabajo reciente no toca. Huele a contención de recursos, pero merece una mirada propia.
- **`String()` en cuatro campos** de clave de subida en `workshop-config/service.ts`, en vez del `readTextField` que rechaza no-strings. Fuera de alcance desde WU1. Solo los escribe la ruta con una clave generada por el servidor, nunca entrada cruda.
- **`registry-types.ts`** existe para romper un ciclo de tipos que hoy no cierra en runtime, pero está a un template de cerrarse. Revisar antes de sumar más al grafo.

---

## Pendiente 4 — despliegue

Nada de esto está desplegado. No hay pipeline en el repo y la única `DATABASE_URL` apunta al Postgres local.

**Antes de desplegar, en este orden:**

1. Bajar el worker viejo
2. Correr `scripts/drain-pdf-queue.sh` con la `DATABASE_URL` de producción
3. Levantar el worker nuevo

El script se niega a arrancar sin `DATABASE_URL` explícita, muestra los conteos antes de tocar nada, **cancela en vez de borrar** (queda el rastro de auditoría) y sale distinto de cero si algo quedó pendiente.

**Por qué importa:** WU3 cambió la forma del branding y WU4 cambió `price` escalar por `prices` de tres niveles. Un trabajo encolado antes del despliegue y tomado por el worker nuevo **falla dentro de un proceso desacoplado, sin nadie a quien reportarle**. El usuario ve un catálogo que nunca llega y ningún mensaje que lo explique.

Y `0009` **dropea** cuatro columnas de `template_config`. Ya está en `main`: volver atrás no es solo revertir código.

---

## Estado actual del sistema

Cinco unidades mergeadas y archivadas (PR #33, #35, #36, #37, #38), más el tracker a `main` (#39), el script de drenado (#40) y la paginación por altura (#41).

Funciona de verdad:

- Galería de plantillas; tipografía y colores fijos por plantilla, ya no se eligen en cada generación
- Logo, texto de portada y datos de contacto pertenecen al taller, no a la plantilla
- Los tres precios (Venta, Taller, Socio) en cada producto; un nivel sin precio usable muestra `—`, nunca `$0.00`
- El logo se inlinea como data URI leyendo R2 del lado del servidor, porque **Playwright no puede autenticarse** contra la ruta protegida
- La paginación mide altura real en Chromium; `productsPerPage` es un **máximo**, no una cantidad exacta

Specs consolidadas por primera vez en `openspec/specs/`. El cambio quedó en `openspec/changes/archive/2026-08-12-catalog-templates-and-workshop-info/`.

---

## Trampas conocidas de las herramientas

- **GGA v2.10.1**: `PR_BASE_BRANCH` no se aplica (defecto reportado río arriba). Siempre revisa `main...HEAD` y arrastra trabajo ya mergeado. Verificá con `git show <base>:<archivo>` antes de arreglar algo que quizá no escribiste. Sus rondas **no convergen solas**: tope de 3 a 5, y si una ronda contradice a otra, cortar y documentar.
- **`fd` no responde "¿está en el repo?"**. La fase de archivado dejó `openspec/specs/` sin trackear; se verificó con `fd`, que mira el disco, y se mergeó `main` sin esos archivos. Para esa pregunta va `git ls-tree`.
- **OpenPencil**: para diseño de página conviene HTML/CSS renderizado con `agent-browser`, no la maqueta. El render real es Chromium vía Playwright, así que el HTML **es** el entregable. `clip-path` da diagonales exactas; en OpenPencil hay que fingirlas con rectángulos rotados que desbordan el marco, y `clipsContent` no recorta.
- **Capturas**: `agent-browser screenshot` toma el viewport entero salvo que le pases un selector. Fijá el tamaño con `agent-browser set viewport 816 1056 2` o el PNG sale con bandas en blanco y proporción equivocada.

---

## Cómo retomar

1. Leé este archivo y `openspec/changes/archive/2026-08-12-catalog-templates-and-workshop-info/archive-report.md`
2. La memoria de Engram del proyecto `dforce-catalog` tiene el detalle por unidad de trabajo
3. Para ver qué renderiza hoy: script `tsx` que llame a `renderCatalogHtml` directamente con los datos reales de la base y volcá el markup por sección. Es como se encontró todo esto.
4. El trabajo grande —traducir el mockup— merece su propia unidad, con **inspección visual del PDF real como puerta de salida**. Una suite verde no prueba nada sobre cómo se ve algo.
