# Delta Spec: catalog-generation (catalog-cover-templates)

> The main spec has no title requirement; the current behaviour (title derived
> from category names, `deriveCatalogTitle`) was never specified. This delta
> adds the owner's rule, which replaces that derivation. Open PR #146 edits this
> same file — rebase whichever lands second.

## ADDED Requirements

### Requirement: Operator-Typed Catalog Title

The builder SHALL offer an optional free-text field "Título del catálogo". The
catalog title MUST be `Catálogo: <text>`, where `<text>` is the typed value
trimmed with inner whitespace collapsed, or `Catálogo` when that value is
empty. The typed value MUST NOT exceed 40 characters after trimming; the
limit MUST be enforced in the builder and re-validated by the generate
endpoint, which derives the stored title itself. The same title MUST be the
cover heading in every template, the stored `catalogs.title`, and the
downloaded PDF's filename. The title MUST NOT be derived from category names.

#### Scenario: Typed title

- GIVEN the operator types "Repuestos"
- WHEN the catalog is generated
- THEN the cover, the stored title and the filename MUST all read
  "Catálogo: Repuestos"

#### Scenario: Empty title

- GIVEN the field is empty or whitespace only
- WHEN the catalog is generated
- THEN the title MUST be "Catálogo"

#### Scenario: Over-long title refused

- GIVEN a typed value of 41 characters after trimming reaches the generate
  endpoint
- WHEN it validates the request
- THEN it MUST answer 400 with a Spanish error under `errors.title` and MUST NOT
  enqueue a job, and the builder MUST show that error beside the field

#### Scenario: Long title fits the cover

- GIVEN a 40-character title on "Portada completa"
- WHEN the cover renders
- THEN the title MUST shrink to fit within two lines inside the cover's title
  block, never overflowing the page

#### Scenario: Any typed character downloads

- GIVEN a title containing a double quote or a character outside Latin-1
  (e.g. "—")
- WHEN the PDF is downloaded
- THEN the response MUST succeed and the filename MUST preserve the title
