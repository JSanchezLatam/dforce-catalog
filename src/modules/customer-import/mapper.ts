/**
 * Maps one raw Interfuerza `customers` row onto this app's `cliente` shape.
 *
 * Field names and cardinalities below are MEASURED, from a live sweep of all
 * 370 rows recorded in `openspec/changes/customer-import/proposal.md` — not
 * taken from the vendor docs, which described a REST API that does not exist
 * and cost this integration a full rewrite once already.
 *
 * Never throws. A row this app cannot represent becomes a SKIP carrying a
 * reason, so the run completes and the report can name it. A throw here would
 * abort an import of 370 customers over one bad row.
 */

export type MappedCustomer = {
  kind: "customer";
  externalId: string;
  name: string;
  phone: string;
  email: string | null;
};

export type SkipReason = "missing_external_id" | "missing_name" | "missing_phone";

export type SkippedCustomer = {
  kind: "skip";
  reason: SkipReason;
  /** Both are best-effort: they exist so the report can NAME who was skipped. */
  externalId: string | null;
  name: string | null;
};

export type MappedRow = MappedCustomer | SkippedCustomer;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function mapCustomerRow(raw: unknown): MappedRow {
  const source = (raw ?? {}) as Record<string, unknown>;

  // `Cliente`, NOT `Token`. `Token` is named like an identifier and is empty
  // on all 370 live rows — using it would dedupe every customer onto one key.
  const externalId = text(source.Cliente);
  // `Nombre` only. `Contacto` is a contact PERSON, filled on roughly one row
  // in twenty; as a fallback it silently renames a customer to their
  // receptionist.
  const name = text(source.Nombre);

  if (!externalId) {
    return { kind: "skip", reason: "missing_external_id", externalId: null, name: name || null };
  }
  if (!name) {
    return { kind: "skip", reason: "missing_name", externalId, name: null };
  }

  // `Telefono_1` first despite `Cellular` sounding like the WhatsApp-capable
  // field: 361/370 vs 45/370. Preferring the mobile-sounding one would leave
  // 316 customers with no phone and skip them.
  //
  // VERBATIM — no normalisation, no `+507`, no stripping separators. The owner
  // chose raw knowing an 8-digit Panama number is not E.164 and therefore
  // cannot receive a WhatsApp reminder (design D4). If that decision changes,
  // it changes here and deliberately.
  // TWO sources, matching design D4. `Telefono_2` was measured EMPTY on all
  // 370 rows, so a third clause would be a branch no fixture can populate and
  // no mutation can prove — dead by measurement, not by guess.
  const phone = text(source.Telefono_1) || text(source.Cellular);
  if (!phone) {
    // 9 of the 370. `cliente.phone` is NOT NULL and R17 requires it, so the
    // alternatives were inventing a number or writing a row this app's own
    // form would reject (design D5).
    return { kind: "skip", reason: "missing_phone", externalId, name };
  }

  // `null`, never `""` — the column is nullable, and an empty string is not
  // "no email": it renders as a blank cell and fails an email-format check.
  const email = text(source.Email) || null;

  return { kind: "customer", externalId, name, phone, email };
}
