/**
 * The Ley 81 consent clause shown to staff (customer-portal WU1) and, later,
 * printed on the work-order sheet. Pure and dependency-free so a client
 * component can import it.
 *
 * PROVISIONAL until a Panamanian lawyer supplies the final text. Replacing the
 * text means a NEW `CONSENT_CLAUSE_VERSION` in `consent.ts`; existing rows keep
 * the version they were recorded under.
 */
export const CONSENT_CLAUSE_BANNER = "Texto provisorio — pendiente de revisión legal";

export const CONSENT_CLAUSE_PARAGRAPHS: readonly string[] = [
  "Autorizo a DForce Car Audio a usar mis datos para darme acceso a un portal donde puedo consultar el historial de órdenes de servicio de mis vehículos: placas, estado de cada orden, fechas, descripción del trabajo, hallazgos y recomendaciones.",
  "Entiendo que esos datos se guardan con un proveedor de nube fuera de Panamá, y que puedo retirar mi consentimiento en el taller en cualquier momento.",
];
