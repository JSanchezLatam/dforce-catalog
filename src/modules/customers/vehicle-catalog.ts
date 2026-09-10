/**
 * vehicle-catalog.ts — the curated in-repo make/model list `VehicleMakeModelFields`
 * drives on both vehicle write paths (design.md D13). A plain `Record`, zero
 * I/O, zero classes: `Object.keys` IS the make list, `VEHICLE_CATALOG[make]`
 * IS the model list, and the whole thing diffs like the JSON it is shaped as.
 *
 * **Why curated and not fetched.** `vpic.nhtsa.dot.gov` (verified live) returns
 * 58 Toyota models and contains NONE of Hilux, Fortuner, Land Cruiser Prado or
 * Rush — it carries "Land Cruiser" but not the distinct Prado trim.
 * `us-car-models-data` is the same US-registration data by another route. This
 * is a Panama workshop; `vehicle-catalog.test.ts` pins those four models by
 * name specifically so a future "let's just use the real dataset" regenerates
 * this file and fails loudly on the day it does.
 *
 * **Why every make survives.** The list was checked against 699 rows of the
 * owner's own synced product data before he saw it (false positives
 * hand-filtered — `RAM` matched "CERAMICA", `MG` matched a spec fragment,
 * `Mini` matched "MINI CHUCHERO"). A PARTS catalog is weak evidence about the
 * FLEET — an oil change or an alignment needs no brand-specific part — so
 * absence from that search is not evidence a make never comes through the
 * door. The owner's answer to the drafted list was "agregá Lexus, no saques
 * ninguna": one addition, nothing removed.
 *
 * Origin grouping (review-only; provenance, not behaviour — the select below
 * never renders it, and reordering this comment changes nothing):
 * - Japanese: Toyota, Nissan, Honda, Mitsubishi, Suzuki, Mazda, Isuzu, Subaru, Daihatsu, Lexus
 * - Korean: Hyundai, Kia, SsangYong
 * - Chinese: Chery, Great Wall, Haval, JAC, BYD, Changan, Geely, MG, Foton, Dongfeng, BAIC
 * - American: Chevrolet, Ford, Jeep, Dodge, RAM, GMC
 * - European: Volkswagen, Mercedes-Benz, BMW, Audi, Peugeot, Renault, Volvo, Land Rover, Fiat
 * - Indian: Mahindra, Tata
 *
 * Model lists are Panama-market, authored per make by the owner's judgement —
 * they are the part that can be wrong without breaking anything, which is
 * exactly what the "Otro" free-text escape (`VehicleMakeModelFields.tsx`) is
 * for. Keys below are authored in sorted order; `vehicle-catalog.test.ts`
 * asserts that order rather than trusting it stays that way by hand.
 */
export const VEHICLE_CATALOG: Readonly<Record<string, readonly string[]>> = {
  Audi: ["A3", "A4", "Q3", "Q5", "Q7"],
  BAIC: ["X25", "X35", "X55", "D20"],
  BMW: ["Serie 3", "Serie 5", "X1", "X3", "X5"],
  BYD: ["Song Plus", "Yuan Plus", "Dolphin", "Han", "Tang"],
  Changan: ["CS35 Plus", "CS55 Plus", "Alsvin", "Eado"],
  Chery: ["Tiggo 2", "Tiggo 3", "Tiggo 4", "Tiggo 7 Pro", "Tiggo 8 Pro", "Arrizo 5"],
  Chevrolet: ["Spark", "Sail", "Onix", "Tracker", "Captiva", "Silverado", "Colorado"],
  Daihatsu: ["Terios", "Bego", "Xenia"],
  Dodge: ["Attitude", "Journey", "Durango", "Charger"],
  Dongfeng: ["Rich 6", "AX7", "Glory 580"],
  Fiat: ["Uno", "Mobi", "Strada", "Toro"],
  Ford: ["Fiesta", "Focus", "Escape", "Explorer", "Ranger", "EcoSport", "F-150"],
  Foton: ["Tunland", "Sauvana", "View"],
  GMC: ["Sierra", "Terrain", "Acadia"],
  Geely: ["Coolray", "Emgrand", "Azkarra"],
  "Great Wall": ["Poer", "Wingle 5", "H6"],
  Haval: ["H6", "Jolion", "H2"],
  Honda: ["Civic", "Accord", "CR-V", "HR-V", "Fit", "Pilot"],
  Hyundai: ["Accent", "Elantra", "Tucson", "Santa Fe", "Creta", "H1", "Grand i10"],
  Isuzu: ["D-Max", "MU-X", "Trooper"],
  JAC: ["J7", "S3", "T6", "T8"],
  Jeep: ["Renegade", "Compass", "Wrangler", "Grand Cherokee", "Cherokee"],
  Kia: ["Rio", "Picanto", "Sportage", "Sorento", "Soul", "Seltos", "Cerato"],
  "Land Rover": ["Discovery", "Discovery Sport", "Range Rover", "Range Rover Evoque", "Defender"],
  Lexus: ["RX", "NX", "IS", "ES"],
  MG: ["MG3", "MG5", "ZS", "HS"],
  Mahindra: ["Bolero", "Scorpio", "XUV500", "KUV100"],
  Mazda: ["Mazda2", "Mazda3", "CX-5", "CX-30", "BT-50"],
  "Mercedes-Benz": ["Clase A", "Clase C", "Clase E", "GLA", "GLC", "Sprinter"],
  Mitsubishi: ["Lancer", "Mirage", "Outlander", "Montero", "L200"],
  Nissan: ["Sentra", "Versa", "Altima", "X-Trail", "Kicks", "Frontier", "Urvan"],
  Peugeot: ["208", "2008", "3008", "301"],
  RAM: ["700", "1500", "2500"],
  Renault: ["Sandero", "Logan", "Duster", "Kwid", "Koleos"],
  SsangYong: ["Tivoli", "Korando", "Rexton", "Actyon"],
  Subaru: ["Impreza", "Forester", "XV", "Outback"],
  Suzuki: ["Alto", "Swift", "Baleno", "Vitara", "Grand Vitara", "Ertiga", "Jimny"],
  Tata: ["Nexon", "Tiago", "Tigor"],
  Toyota: [
    "Corolla",
    "Yaris",
    "Camry",
    "RAV4",
    "Hilux",
    "Fortuner",
    "Land Cruiser",
    "Land Cruiser Prado",
    "Rush",
    "Avanza",
    "Tacoma",
    "Tundra",
  ],
  Volkswagen: ["Gol", "Vento", "Jetta", "Tiguan", "Amarok"],
  Volvo: ["XC40", "XC60", "XC90"],
};

/** Authored (and asserted) sorted — a new make has exactly one correct insertion point. */
export const VEHICLE_MAKES: readonly string[] = Object.keys(VEHICLE_CATALOG);

/**
 * The select's stand-in for "not in the list" (`VehicleMakeModelFields.tsx`).
 * Never storable, never a make — `vehicle-catalog.test.ts` asserts it collides
 * with no key above.
 */
export const OTHER = "__otro__";

/**
 * `[]` for a make the catalog does not list — the NORMAL state behind every
 * free-text make (D13), never a throw. Throwing would turn the escape hatch
 * into a crash the moment staff type a make the list has never heard of.
 */
export function modelsForMake(make: string): readonly string[] {
  return VEHICLE_CATALOG[make] ?? [];
}
