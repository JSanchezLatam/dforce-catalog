# vehicle-catalog Specification

## Purpose

The curated in-repo list of vehicle makes and their models, the two selects it
drives on every vehicle write path, and the free-text escape that keeps a
curated list from becoming a data-entry wall.

The dev database holds 370 customers and **3 vehicles**. The fleet is typed in
by hand from here, so the constraint is worth adding now and worthless later —
which is the whole reason this capability exists at this size rather than as a
schema change.

This capability governs the CATALOG and the two CONTROLS it feeds. Where the
resulting `make`/`model` strings are persisted, validated, and reconciled is
owned by `customer-management` (Field Validation, Vehicle Collection
Persistence, Single Vehicle Insert Without Reconcile) and is **unchanged** by
this capability.

**Why a curated file and not a data source.** vPIC (`vpic.nhtsa.dot.gov`,
verified live) returns 58 Toyota models containing **none** of Hilux, Fortuner,
Prado or Rush, and carries "Land Cruiser" but not "Land Cruiser Prado".
`us-car-models-data` is built on the same US registrations. This is a Panama
workshop whose fleet is largely Japanese, Korean and Chinese imports that never
reached the US: either source pushes staff back to free text for exactly the
vehicles they see most. "Suggest from what is already in the database" was
rejected too — it starts empty at 3 rows. A curated file needs no network, no
cache table and no sync job, and is correctable in a one-line PR.

**Why the escape is not optional.** The make list was checked against the
owner's own synced product data and the evidence is thin by construction: a
parts catalog says almost nothing about the FLEET, because a stereo install or
an oil change needs no brand-specific part. The list is trusted as the owner's
judgement, not as a measurement, and a dropdown that cannot express a real
vehicle is worse than the text box it replaced.

## ADDED Requirements

### Requirement: Curated In-Repo Make and Model Catalog

The system MUST ship a curated vehicle catalog as a plain in-repo module,
mapping each make to its list of models. The catalog MUST NOT be fetched over
the network, cached in a database table, synced by a job, or derived from rows
already stored in the database. Correcting the catalog MUST be a single-file
edit requiring no migration, no data backfill, and no deployment step beyond
shipping the code.

The catalog MUST carry exactly the makes the owner settled on, grouped here by
origin for review only — the grouping is provenance, not behaviour, and MUST
NOT change the order or grouping staff see in the select:

| Origin | Makes |
|---|---|
| Japanese | Toyota, Nissan, Honda, Mitsubishi, Suzuki, Mazda, Isuzu, Subaru, Daihatsu, Lexus |
| Korean | Hyundai, Kia, SsangYong |
| Chinese | Chery, Great Wall, Haval, JAC, BYD, Changan, Geely, MG, Foton, Dongfeng, BAIC |
| American | Chevrolet, Ford, Jeep, Dodge, RAM, GMC |
| European | Volkswagen, Mercedes-Benz, BMW, Audi, Peugeot, Renault, Volvo, Land Rover, Fiat |
| Indian | Mahindra, Tata |

No make on that list MAY be removed to make the dataset tidier; the list is the
owner's settled answer, given as "agregá Lexus, no saques ninguna".

#### Scenario: The catalog is readable with no network and no database
- GIVEN a checkout with no database connection and no network access
- WHEN the vehicle catalog module is imported
- THEN it MUST resolve to the full make and model data with no I/O of any kind

#### Scenario: Correcting the catalog is a one-file edit
- GIVEN a make that staff report is missing
- WHEN it is added to the catalog module with its models
- THEN no migration, no backfill, and no change outside that one file MUST be required for it to appear in both vehicle write paths

### Requirement: Make and Model Are Chosen From the Catalog on Both Vehicle Write Paths

`marca` and `modelo` MUST be presented as selects, not free-text inputs, on
**both** vehicle write paths: the order dialog's quick vehicle form and the
customer form's vehicle collection. The model select's options MUST be exactly
the models the catalog lists for the currently selected make — never the union
of all models, and never a list that ignores the make.

Both paths MUST render the same control fed by the same catalog module, so the
two cannot drift apart by editing one screen.

#### Scenario: The make select offers the catalog's makes
- GIVEN either vehicle write path is open
- WHEN staff opens the "Marca" select
- THEN it MUST list every make in the catalog, plus the "Otro" escape option

#### Scenario: Model options follow the selected make
- GIVEN staff selected the make "Toyota"
- WHEN staff opens the "Modelo" select
- THEN it MUST offer only Toyota's models from the catalog, plus "Otro"

#### Scenario: Both write paths offer the same options
- GIVEN a make present in the catalog
- WHEN it is offered on the customer form's vehicle collection
- THEN the order dialog's quick vehicle form MUST offer that same make with the same model list

### Requirement: A Mandatory Free-Text Escape

Both selects MUST offer an "Otro" option. Choosing it MUST reveal a free-text
input for that field, and what staff type there is what MUST be stored — the
literal string "Otro" MUST NEVER be persisted as a make or a model.

The escape MUST be reversible without reloading: after choosing "Otro", staff
MUST still be able to pick a catalog value from the same select and have the
free-text input disappear.

When the make is a free-text value — whether staff chose "Otro" or the stored
make is simply not in the catalog — the catalog has no model list to offer, so
the model field MUST be a plain free-text input rather than a select with a
single escape option in it.

#### Scenario: A make outside the catalog is recordable
- GIVEN staff is adding a vehicle whose make is not in the catalog
- WHEN they choose "Otro" in the "Marca" select and type that make
- THEN the vehicle MUST save with the typed make, and MUST NOT save the string "Otro"

#### Scenario: A catalog make with a model outside the catalog
- GIVEN staff selected the make "Toyota"
- WHEN they choose "Otro" in the "Modelo" select and type a model the catalog does not list
- THEN the vehicle MUST save with "Toyota" as its make and the typed model

#### Scenario: A free-text make leaves the model as free text
- GIVEN the "Marca" select is showing "Otro"
- WHEN staff looks at the "Modelo" field
- THEN it MUST be a free-text input, not a select

#### Scenario: "Otro" is not a dead end
- GIVEN staff chose "Otro" in the "Marca" select by mistake
- WHEN they select a catalog make in that same select
- THEN the free-text make input MUST disappear and the selected catalog make MUST be what is stored

### Requirement: A Stored Value Outside the Catalog Renders As-Is and Is Never Blanked

The stored value outranks the catalog. When an existing vehicle is opened for
editing and its stored `make` or `model` is not in the catalog, the form MUST
display that stored value verbatim and MUST NOT blank it, replace it, or
substitute a catalog value for it. This MUST hold for a value that was never in
the catalog and for one that was removed from the catalog after it was stored.

Opening a vehicle for editing and saving it without touching the make or model
MUST persist exactly the values that were already stored.

#### Scenario: An unknown stored make survives being opened
- GIVEN a stored vehicle with `make = "Hino"`, which the catalog does not list
- WHEN staff opens it for editing
- THEN the form MUST display "Hino" as its make

#### Scenario: An unknown stored value survives an unrelated edit
- GIVEN that same vehicle
- WHEN staff changes only its plate and saves
- THEN the stored make MUST still be "Hino"

#### Scenario: A catalog make with an unknown stored model
- GIVEN a stored vehicle with `make = "Toyota"` and `model = "Coaster"`, a model the catalog does not list for Toyota
- WHEN staff opens it for editing
- THEN the make MUST render as the selected catalog value "Toyota" AND the model MUST render verbatim as "Coaster"

#### Scenario: A make removed from the catalog
- GIVEN a stored vehicle whose make was in the catalog when it was saved and has since been removed from it
- WHEN staff opens that vehicle for editing
- THEN the stored make MUST still be displayed verbatim

### Requirement: Changing the Make Clears the Model

Changing the selected make MUST clear the model, so a model belonging to the
previous make can never remain selected. The clear MUST happen only as a result
of staff changing the make — never on mount, never on re-render, and never as a
reaction to a make value that merely arrived from stored data.

#### Scenario: Switching make drops the previous model
- GIVEN staff selected the make "Toyota" and the model "Hilux"
- WHEN staff changes the make to "Kia"
- THEN the model MUST be empty, and MUST NOT still read "Hilux"

#### Scenario: Switching make drops a free-text model too
- GIVEN staff selected "Toyota" and typed a free-text model via "Otro"
- WHEN staff changes the make to "Kia"
- THEN the model MUST be empty and the model field MUST be back to a select over Kia's models

#### Scenario: Opening a stored vehicle does not clear its model
- GIVEN a stored vehicle with `make = "Toyota"` and `model = "Hilux"`
- WHEN staff opens it for editing and touches nothing
- THEN the model MUST still read "Hilux"

### Requirement: The Catalog Constrains the Form Only — Storage Stays Plain Nullable Text

`vehiculo.make` and `vehiculo.model` MUST remain plain nullable `text` columns.
This capability MUST NOT introduce a database enum, a lookup table, a foreign
key, or any migration. Server-side validation MUST NOT reject a make or model
for being absent from the catalog — doing so would make the free-text escape
unusable and would turn every catalog correction into a data-compatibility
event.

Reverting this capability MUST leave every value already stored — catalog or
free-text — valid and unchanged, because both are and remain ordinary strings
in a nullable text column.

#### Scenario: No schema change ships with the catalog
- GIVEN this capability is implemented
- WHEN the migrations directory is inspected
- THEN it MUST contain no new migration for `vehiculo.make` or `vehiculo.model`

#### Scenario: The API accepts a non-catalog value
- GIVEN a vehicle payload whose `make` is not in the catalog
- WHEN it is submitted to the vehicle write endpoint
- THEN the request MUST be accepted on the same terms as any other make, subject only to the existing per-vehicle plate rule

#### Scenario: A revert leaves stored values valid
- GIVEN vehicles stored with both catalog and free-text makes
- WHEN this capability is reverted and make/model return to plain text inputs
- THEN every stored value MUST still be readable and editable, with no data repair required

### Requirement: Catalog Dataset Shape Invariants

The catalog is roughly three hundred lines of data. Its correctness is not
reviewable row by row, so the dataset MUST satisfy invariants that a test can
assert over the whole file:

- The set of make keys MUST equal exactly the makes enumerated in *Curated
  In-Repo Make and Model Catalog*, asserted as a set rather than as a count —
  a count is a claim that drifts from the list it counts, and this list was
  already miscounted once before it reached this spec.
- Every make key MUST be non-empty and trimmed, with no duplicates.
- Make keys MUST be in a single deterministic order, so a new make has exactly
  one correct insertion point rather than being appended wherever.
- No make MAY be named "Otro" or collide with the escape option's internal
  value — the escape must never be mistakable for a real make.
- Every make MUST have at least one model.
- Within a make, models MUST be non-empty, trimmed, and free of duplicates.
- Toyota's models MUST include `Hilux`, `Fortuner`, `Land Cruiser Prado` and
  `Rush` — the four vPIC omits, and therefore the four that fail immediately if
  anyone ever "improves" the file by regenerating it from a US data source.

#### Scenario: The dataset satisfies its invariants
- GIVEN the catalog module
- WHEN its shape is asserted
- THEN every invariant above MUST hold, and a violation MUST fail by the name of the invariant it broke

#### Scenario: A US-sourced regeneration fails loudly
- GIVEN someone replaces the curated Toyota list with one derived from vPIC
- WHEN the dataset shape test runs
- THEN it MUST fail on the missing Hilux, Fortuner, Land Cruiser Prado and Rush

## Verification Notes

**What only a browser settles.** Whether the two selects are comfortable to
operate on a workshop tablet, and whether the free-text input appearing under a
select reflows the form badly, are layout facts no test in this repo reaches —
no test here can measure a rendered height or a touch target. The make/model
select triggers are form fields sitting in a grid of `h-8` inputs and match
them, exactly as the shipped `UserForm` role select does; AGENTS.md's 44×44
floor governs the ACTION controls around them (the dialog trigger, Cancelar,
Guardar vehículo), which keep their `min-h-11 min-w-11` untouched. That ruling
is written down because it is the only enforcement there is.

**What jsdom cannot see.** Neither vehicle write path adds or removes a Server
Component boundary in this change — both forms are already `"use client"` — but
jsdom would not report it if one appeared, nor a hydration mismatch. The
browser check is the evidence.

**What is unproven by any green suite.** Whether the model lists are the right
models for Panama. That is judgement, not a testable claim, and it is precisely
why the free-text escape is a requirement rather than a convenience.
