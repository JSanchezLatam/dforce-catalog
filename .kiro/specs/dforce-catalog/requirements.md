# Requirements Document

## Introduction

El **Sistema de Generación de Catálogos Dforce Car** es una aplicación web que permite a los empleados y administradores de Dforce Car sincronizar el inventario de productos desde la API de Interfuerza (v4), mantener una base de datos local actualizada, y generar catálogos PDF personalizados a partir de categorías y configuraciones seleccionadas por el usuario.

El sistema cubre cinco áreas funcionales principales:
1. Sincronización de inventario con la API externa de Interfuerza
2. Gestión y visualización del inventario local en PostgreSQL
3. Generación de catálogos PDF personalizados con portada e índice dinámicos
4. Configuración del template del catálogo
5. Autenticación de usuarios con arquitectura preparada para múltiples roles

---

## Glossary

- **Sistema**: La aplicación web completa de generación de catálogos Dforce Car
- **Sync_Service**: El servicio responsable de sincronizar productos desde la API de Interfuerza hacia la base de datos local
- **Inventory_DB**: La base de datos PostgreSQL local que almacena los productos sincronizados
- **API_Interfuerza**: La API externa de inventario (Interfuerza v4) que provee los datos de productos
- **PDF_Generator**: El servicio backend que renderiza templates HTML a PDF usando Puppeteer o Playwright
- **Catalog_Builder**: El módulo de UI que permite al usuario seleccionar categorías y configurar el catálogo antes de generarlo
- **Template_Engine**: El módulo que gestiona y aplica el template configurable del catálogo
- **Auth_Service**: El servicio de autenticación que gestiona sesiones y tokens de usuario
- **Usuario**: Toda persona autenticada en el sistema (empleado o administrador)
- **Administrador**: Usuario con permisos ampliados sobre configuración y sincronización manual
- **Category_L1**: Categoría de primer nivel de un producto, tal como la define la API de Interfuerza
- **Category_L2**: Subcategoría de segundo nivel de un producto, tal como la define la API de Interfuerza
- **Producto**: Registro de inventario obtenido de la API de Interfuerza con su estructura original (e.g. `{"class":"GET","action":"products","id":"PS0000003"}`)
- **Catálogo**: Documento PDF generado a partir de una selección de categorías y productos del inventario local
- **Job_Semanal**: La tarea programada que ejecuta la sincronización automática del inventario una vez por semana
- **IFX_Token**: El token de autenticación emitido por Interfuerza v4, enviado en cada solicitud HTTP mediante el header `X-IFX-Token`
- **PDF_Store**: El servicio de almacenamiento externo (Cloudflare R2) donde se persisten los archivos PDF generados
- **Job_Queue**: La cola de trabajos que gestiona las solicitudes de generación de catálogos PDF de forma secuencial para controlar el uso de recursos

---

## Requirements

---

### Requisito 1: Sincronización Automática Semanal del Inventario

**User Story:** Como administrador del sistema, quiero que el inventario se sincronice automáticamente con la API de Interfuerza una vez por semana, para que la base de datos local siempre refleje el stock actualizado sin intervención manual.

#### Criterios de Aceptación

1. THE Job_Semanal SHALL ejecutar la sincronización completa del inventario una vez por semana en el horario configurado.
2. WHEN el Sync_Service realiza cualquier solicitud a la API_Interfuerza, THE Sync_Service SHALL incluir el IFX_Token en el header HTTP `X-IFX-Token` de cada petición.
3. WHEN el Job_Semanal se ejecuta, THE Sync_Service SHALL obtener todos los productos desde la API_Interfuerza usando el endpoint GET /products con paginación de 25 registros por llamada, respetando el rate limit de 20 peticiones cada 10 segundos mediante una espera de 500ms entre peticiones consecutivas.
4. WHEN la API_Interfuerza devuelve una página de resultados, THE Sync_Service SHALL continuar solicitando páginas sucesivas hasta que no existan más registros disponibles.
5. WHEN la sincronización finaliza exitosamente, THE Sync_Service SHALL actualizar el Inventory_DB con los productos obtenidos, preservando la estructura de datos original de la API_Interfuerza.
6. WHEN el Job_Semanal inicia, THE Sync_Service SHALL registrar en el log del sistema la fecha y hora de inicio de la sincronización.
7. WHEN el Job_Semanal finaliza, THE Sync_Service SHALL registrar en el log del sistema la fecha y hora de finalización y la cantidad total de productos sincronizados.
8. IF la API_Interfuerza devuelve un código de error HTTP durante la sincronización, THEN THE Sync_Service SHALL registrar el error con el detalle del código recibido y reintentar la solicitud hasta 3 veces con un intervalo de 60 segundos entre intentos.
9. IF todos los reintentos de una solicitud paginada fallan, THEN THE Sync_Service SHALL abortar la sincronización en curso y conservar el estado previo del Inventory_DB sin modificaciones parciales.

> **Nota de corrección (interfuerza-api-contract-fix, 2026-07 — verificado con smoke test en vivo):** El contrato real de la API_Interfuerza NO es GET /products con query params. Es un único endpoint POST a IFX_BASE_URL con body JSON {class:"GET",action:"products",page:"<string>",filters:[{field,type:"=",value}]}. La respuesta trae {products:[...], count} donde count es el total global; la paginación (25/página) termina cuando page*25>=count. El passthrough de Category_L1/L2 (R3.3) se envía como entradas del array filters, no como query param. Ver sdd/interfuerza-api-contract-fix.

---

### Requisito 2: Sincronización Manual del Inventario

**User Story:** Como administrador del sistema, quiero poder forzar una sincronización inmediata del inventario, para reflejar cambios urgentes en el stock sin esperar al ciclo semanal automático.

#### Criterios de Aceptación

1. WHEN un Administrador solicita una sincronización manual desde la vista de inventario, THE Sync_Service SHALL iniciar la sincronización completa con la API_Interfuerza de forma inmediata.
2. WHILE el Sync_Service está ejecutando una sincronización, THE Sistema SHALL mostrar al Usuario el estado de progreso de la sincronización en curso.
3. WHILE el Sync_Service está ejecutando una sincronización, THE Sistema SHALL deshabilitar el botón de sincronización manual para evitar ejecuciones concurrentes.
4. WHEN la sincronización manual finaliza exitosamente, THE Sistema SHALL notificar al Administrador con la cantidad total de productos sincronizados y la fecha y hora de finalización.
5. IF el Sync_Service ya está ejecutando una sincronización cuando se recibe una nueva solicitud manual, THEN THE Sistema SHALL rechazar la solicitud e informar al Administrador que ya existe una sincronización en curso.

---

### Requisito 3: Filtrado del Inventario por Categorías

**User Story:** Como usuario del sistema, quiero filtrar el inventario por Category_L1 y Category_L2, para encontrar rápidamente los productos que necesito visualizar o incluir en un catálogo.

#### Criterios de Aceptación

1. THE Sistema SHALL permitir al Usuario filtrar el inventario por Category_L1.
2. THE Sistema SHALL permitir al Usuario filtrar el inventario por Category_L2.
3. WHEN el Usuario aplica un filtro de Category_L1, THE Sync_Service SHALL pasar ese valor como parámetro al endpoint GET /products de la API_Interfuerza en la siguiente sincronización con filtro.
4. WHEN el Usuario aplica un filtro por categoría en la vista de inventario, THE Sistema SHALL mostrar únicamente los productos del Inventory_DB que correspondan al filtro seleccionado.
5. WHEN el Usuario elimina todos los filtros activos, THE Sistema SHALL mostrar la totalidad de productos disponibles en el Inventory_DB.

> **Nota de corrección (interfuerza-api-contract-fix, 2026-07 — verificado con smoke test en vivo):** El contrato real de la API_Interfuerza NO es GET /products con query params. Es un único endpoint POST a IFX_BASE_URL con body JSON {class:"GET",action:"products",page:"<string>",filters:[{field,type:"=",value}]}. La respuesta trae {products:[...], count} donde count es el total global; la paginación (25/página) termina cuando page*25>=count. El passthrough de Category_L1/L2 (R3.3) se envía como entradas del array filters, no como query param. Ver sdd/interfuerza-api-contract-fix.

---

### Requisito 4: Visualización del Inventario Local

**User Story:** Como usuario del sistema, quiero visualizar el inventario sincronizado desde la API de Interfuerza, para consultar el stock disponible y sus detalles.

#### Criterios de Aceptación

1. THE Sistema SHALL presentar al Usuario una vista paginada del inventario almacenado en el Inventory_DB.
2. THE Sistema SHALL mostrar para cada Producto al menos su identificador, nombre, Category_L1 y Category_L2.
3. WHEN el Usuario navega entre páginas del inventario, THE Sistema SHALL cargar y mostrar los registros correspondientes a la página solicitada sin recargar la vista completa.
4. WHEN el Inventory_DB no contiene registros, THE Sistema SHALL mostrar al Usuario un mensaje indicando que el inventario está vacío y que puede iniciar una sincronización.

---

### Requisito 5: Selección de Categorías y Productos para el Catálogo

**User Story:** Como usuario del sistema, quiero seleccionar qué categorías y productos incluir en el catálogo, para generar un documento PDF relevante y personalizado para cada necesidad comercial.

#### Criterios de Aceptación

1. THE Catalog_Builder SHALL permitir al Usuario seleccionar una o más categorías de Category_L1 para incluir en el catálogo.
2. THE Catalog_Builder SHALL permitir al Usuario seleccionar una o más categorías de Category_L2 para incluir en el catálogo.
3. THE Catalog_Builder SHALL permitir al Usuario excluir categorías o productos específicos del catálogo, aunque pertenezcan a una Category_L1 o Category_L2 seleccionada.
4. THE Catalog_Builder SHALL permitir al Usuario configurar la cantidad de productos por página del catálogo, aceptando valores enteros entre 1 y 20.
5. WHEN el Usuario modifica la selección de categorías, THE Catalog_Builder SHALL actualizar el título del catálogo en tiempo real para reflejar las categorías incluidas.
6. WHEN el Usuario modifica la selección de categorías, THE Catalog_Builder SHALL actualizar la vista previa del índice del catálogo en tiempo real para reflejar las secciones que se generarán.
7. IF el Usuario intenta generar el catálogo sin haber seleccionado al menos una categoría, THEN THE Catalog_Builder SHALL mostrar un mensaje de error indicando que debe seleccionarse al menos una categoría antes de continuar.
8. THE Catalog_Builder SHALL limitar la selección total de productos de un catálogo a un máximo de 200, en línea con el límite de rendimiento del PDF_Generator (NFR-3).
9. IF el Usuario selecciona categorías cuyo total de productos supera las 200 unidades, THEN THE Catalog_Builder SHALL mostrar un mensaje de error indicando el total actual y que debe reducir la selección antes de continuar.

---

### Requisito 6: Generación del Catálogo PDF

**User Story:** Como usuario del sistema, quiero generar un catálogo en formato PDF a partir de las categorías y configuraciones que seleccioné, para distribuirlo a clientes o utilizarlo como material de ventas.

#### Criterios de Aceptación

1. WHEN el Usuario confirma la generación del catálogo, THE PDF_Generator SHALL producir un archivo PDF que incluya portada, índice dinámico y las páginas de productos correspondientes a las categorías seleccionadas.
2. WHEN el PDF_Generator genera el catálogo, THE PDF_Generator SHALL aplicar el template configurado en el Template_Engine para determinar el diseño visual del documento.
3. WHEN el PDF_Generator genera el catálogo, THE PDF_Generator SHALL incluir en el índice únicamente las secciones de categorías que contengan al menos un producto incluido.
4. WHEN el PDF_Generator genera el catálogo, THE PDF_Generator SHALL mostrar en la portada el título del catálogo derivado de las categorías seleccionadas por el Usuario.
5. WHEN la generación del catálogo finaliza exitosamente, THE Sistema SHALL notificar al Usuario que el catálogo está disponible y permitir su descarga inmediata.
6. WHILE el PDF_Generator está procesando la generación del catálogo, THE Sistema SHALL mostrar al Usuario un indicador de progreso.
7. IF el PDF_Generator encuentra un error durante la generación del PDF, THEN THE Sistema SHALL notificar al Usuario con un mensaje descriptivo del error y conservar la configuración de selección ingresada para que el Usuario pueda reintentar.
8. THE PDF_Generator SHALL generar el catálogo renderizando el template HTML mediante Puppeteer o Playwright en el servidor backend.

---

### Requisito 7: Visualización y Descarga del Catálogo Generado

**User Story:** Como usuario del sistema, quiero visualizar los catálogos ya generados y descargarlos, para acceder fácilmente a documentos previamente producidos sin necesidad de regenerarlos.

#### Criterios de Aceptación

1. THE Sistema SHALL presentar al Usuario una vista con el listado de los catálogos que ese mismo Usuario generó previamente, mostrando al menos el nombre del catálogo, la fecha de generación y las categorías incluidas.
2. THE Sistema SHALL permitir al Administrador visualizar el listado de catálogos generados por todos los Usuarios, además de los propios.
3. WHEN el Usuario selecciona un catálogo de la lista, THE Sistema SHALL permitir la previsualización del PDF en el navegador.
4. WHEN el Usuario solicita la descarga de un catálogo, THE Sistema SHALL iniciar la descarga del archivo PDF correspondiente.
5. IF el archivo PDF de un catálogo listado ya no existe en el servidor, THEN THE Sistema SHALL informar al Usuario que el archivo no está disponible y ofrecer la opción de regenerarlo.

---

### Requisito 8: Configuración del Template del Catálogo

**User Story:** Como administrador del sistema, quiero personalizar el template visual del catálogo, para que el documento generado refleje la identidad de marca de Dforce Car.

#### Criterios de Aceptación

1. THE Template_Engine SHALL permitir al Administrador configurar los elementos visuales del template del catálogo, incluyendo al menos: logo, colores primarios, tipografía y texto de portada.
2. WHEN el Administrador guarda una nueva configuración del template, THE Template_Engine SHALL aplicar esa configuración a todos los catálogos generados a partir de ese momento.
3. WHEN el Administrador modifica el template, THE Sistema SHALL mostrar una vista previa del diseño resultante antes de que el Administrador confirme los cambios.
4. THE Template_Engine SHALL preservar la última configuración de template guardada de forma persistente en el Inventory_DB, de modo que los reinicios del servidor no pierdan la configuración.

---

### Requisito 9: Autenticación de Usuarios

**User Story:** Como usuario del sistema, quiero autenticarme de forma segura para acceder a las funcionalidades del sistema, de modo que solo el personal autorizado de Dforce Car pueda utilizarlo.

#### Criterios de Aceptación

1. WHEN un Usuario ingresa credenciales válidas (usuario y contraseña), THE Auth_Service SHALL emitir un token de sesión válido y redirigir al Usuario a la vista principal del sistema.
2. WHEN un Usuario ingresa credenciales inválidas, THE Auth_Service SHALL devolver un mensaje de error genérico indicando que las credenciales son incorrectas, sin revelar si el usuario existe o no.
3. WHEN un token de sesión expira, THE Auth_Service SHALL redirigir al Usuario a la vista de autenticación para que inicie sesión nuevamente.
4. IF un Usuario no autenticado intenta acceder a una ruta protegida del sistema, THEN THE Auth_Service SHALL redirigir la solicitud a la vista de autenticación.
5. THE Auth_Service SHALL almacenar las contraseñas de los usuarios en el Inventory_DB utilizando bcrypt con un factor de coste mínimo de 12 (cost factor ≥ 12), generando un salt único por usuario en cada operación de hash.
6. THE Sistema SHALL estructurar el Auth_Service con soporte para múltiples roles de usuario, de modo que nuevos roles puedan agregarse sin modificar la arquitectura de autenticación existente.

---

### Requisito 10: Parseo y Serialización de Datos de Productos (Round-Trip)

**User Story:** Como sistema, quiero garantizar la integridad de los datos de productos al transformarlos entre la API externa y la base de datos local, para evitar pérdida o corrupción de información durante la sincronización.

#### Criterios de Aceptación

1. WHEN el Sync_Service recibe una respuesta paginada de la API_Interfuerza, THE Sync_Service SHALL parsear cada objeto de producto al modelo interno de Producto sin pérdida de campos definidos en la estructura de la API.
2. WHEN el Sync_Service escribe un Producto en el Inventory_DB, THE Sync_Service SHALL serializar el Producto al formato de almacenamiento PostgreSQL preservando todos los campos del modelo interno.
3. FOR ALL Productos almacenados en el Inventory_DB, THE Sync_Service SHALL garantizar que parsear un Producto desde la API, serializarlo al Inventory_DB y leerlo de vuelta produzca un objeto equivalente al original recibido de la API (propiedad round-trip).
4. IF el Sync_Service recibe un objeto de Producto con campos desconocidos o nulos que no están en el modelo definido, THEN THE Sync_Service SHALL registrar una advertencia en el log y continuar procesando los demás productos de la página.

---

### Requisito 11: Almacenamiento y Retención de Catálogos PDF

**User Story:** Como usuario del sistema, quiero que los catálogos que genero se guarden de forma confiable y que el sistema administre automáticamente los más viejos, para no ocupar espacio indefinidamente y tener siempre acceso a mis últimas versiones.

#### Criterios de Aceptación

1. WHEN el PDF_Generator finaliza la generación de un catálogo exitosamente, THE Sistema SHALL subir el archivo PDF al PDF_Store (Cloudflare R2) y registrar su URL de acceso y metadatos en el Inventory_DB.
2. THE Sistema SHALL retener un máximo de 2 catálogos generados por Usuario en el PDF_Store en cualquier momento.
3. WHEN el PDF_Generator finaliza la generación de un catálogo para un Usuario que ya tiene 2 catálogos almacenados, THE Sistema SHALL notificar al Usuario con un mensaje de advertencia indicando que el catálogo más antiguo de su cuenta será eliminado automáticamente para dar lugar al nuevo.
4. WHEN el Sistema procede con la eliminación automática por cuota, THE Sistema SHALL eliminar el catálogo más antiguo del Usuario tanto del PDF_Store como del Inventory_DB, y registrar el evento en el log del sistema.
5. IF la subida del PDF al PDF_Store falla, THEN THE PDF_Generator SHALL conservar el archivo temporalmente en memoria por un máximo de 5 minutos, reintentar la subida hasta 2 veces con un intervalo de 30 segundos, y notificar al Usuario del error si todos los intentos fallan.

---

### Requisito 12: Cola de Generación de Catálogos PDF

**User Story:** Como sistema, quiero gestionar las solicitudes concurrentes de generación de catálogos mediante una cola, para garantizar estabilidad del servidor cuando múltiples usuarios generan catálogos simultáneamente.

#### Criterios de Aceptación

1. THE Job_Queue SHALL procesar las solicitudes de generación de catálogos PDF de forma secuencial, permitiendo un máximo de 1 trabajo activo simultáneamente en el PDF_Generator.
2. WHEN un Usuario solicita la generación de un catálogo y el PDF_Generator ya está procesando otro trabajo, THE Job_Queue SHALL encolar la solicitud y notificar al Usuario su posición en la cola.
3. WHEN la posición de un Usuario en la Job_Queue cambia, THE Sistema SHALL actualizar al Usuario con su nueva posición en tiempo real.
4. WHEN el trabajo de un Usuario alcanza la primera posición de la Job_Queue e inicia su procesamiento, THE Sistema SHALL notificar al Usuario que su catálogo está siendo generado.
5. THE Job_Queue SHALL aceptar un máximo de 3 trabajos encolados simultáneamente (1 activo + 2 en espera), correspondiendo al máximo de usuarios concurrentes esperados del sistema.
6. IF un Usuario intenta encolar una solicitud cuando la Job_Queue ya tiene 3 trabajos (capacidad máxima), THEN THE Sistema SHALL rechazar la solicitud e informar al Usuario que el sistema está en capacidad máxima y que puede reintentar en unos minutos.

---

## Non-Functional Requirements

### Rendimiento

- **NFR-1**: El Sync_Service SHALL respetar el rate limit de la API_Interfuerza de 20 peticiones por cada 10 segundos, implementando una espera mínima de 500ms entre solicitudes consecutivas para evitar el bloqueo de IP por 1 hora.
- **NFR-2**: La vista paginada del inventario SHALL cargar y renderizar cada página de resultados en menos de 2 segundos bajo condiciones normales de red.
- **NFR-3**: El PDF_Generator SHALL completar la generación de un catálogo de hasta 200 productos en menos de 60 segundos.

### Seguridad

- **NFR-4**: El IFX_Token de la API_Interfuerza SHALL almacenarse exclusivamente como variable de entorno del servidor y no deberá aparecer en ningún log, respuesta HTTP, o archivo versionado en el repositorio.
- **NFR-5**: Todas las rutas de la aplicación excepto `/login` SHALL requerir un token de sesión válido; cualquier solicitud sin token válido SHALL recibir una respuesta HTTP 401 antes de ejecutar cualquier lógica de negocio.
- **NFR-8**: Las acciones restringidas a Administrador (sincronización manual del Requisito 2, configuración del template del Requisito 8, y el listado global de catálogos del Requisito 7.2) SHALL verificar el rol del Usuario autenticado antes de ejecutar la lógica de negocio; cualquier solicitud de un Usuario sin rol Administrador SHALL recibir una respuesta HTTP 403.

### Almacenamiento

- **NFR-6**: Los archivos PDF generados SHALL persistir en Cloudflare R2 (PDF_Store) y no en el filesystem local del servidor, garantizando que los archivos sobrevivan reinicios y redeployments del servidor.
- **NFR-7**: El sistema SHALL retener un máximo de 2 PDFs por Usuario en el PDF_Store; la cuota SHALL aplicarse por usuario y no de forma global.
