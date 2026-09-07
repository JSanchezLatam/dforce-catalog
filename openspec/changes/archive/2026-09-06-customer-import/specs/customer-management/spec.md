# Delta Spec: customer-management (customer-import)

Modifies `openspec/specs/customer-management/spec.md`.

**The capability-wide grep this change owes (WU6.1).**

C2 learned at review round 10 that **full-restatement discipline follows the
DATA SHAPE, not only the requirement being edited** — R19 was left demanding a
`phone = null` row that migration `0016` had made unconstructible, because the
acknowledgement lived inside R17's rationale and the archiver replaces R17
without touching R19.

So, before adding anything, every requirement in this capability was checked
against the shapes this change moves — `cliente` identity, `phone`, and how a
customer comes into existence:

- **R16** lists what staff create through the form and says nothing that a
  second creation path contradicts. `externalId` is not a user-entered field
  and does not belong in that list. **Unchanged.**
- **R17** requires `name` and `phone`, and a phone of 7–15 digits. The imported
  values satisfy it: the live data is 353 rows of 8 digits, 7 of 11, and 1 of
  7. The 9 rows with no phone are refused by the import for exactly this
  requirement's reason. **Unchanged, and deliberately binding on the import.**
- **R18** — already rewritten by `customer-shared-phones` so a phone no longer
  identifies one person. **That rewrite is what makes this import possible**:
  9 phone values are shared by 18 of these customers, and under the original
  R18 the import would have refused every one of them. **Unchanged.**
- **R19** — restated by both earlier changes; the search predicate is
  unaffected by provenance. **Unchanged.**
- The two vehicle requirements do not touch `cliente` identity. **Unchanged.**

No requirement needed restating. Recorded here as a completed check rather than
left implicit, because "nothing needed changing" and "nobody looked" are
indistinguishable in an archive.

## ADDED Requirements

### Requirement: Customer Import from Interfuerza (R21)

Staff MUST be able to import customers from Interfuerza on demand, and to run
that import repeatedly without duplicating anyone. The action requires
`customers.write`.

Each imported `cliente` MUST be matched to its Interfuerza record by an
external identifier stored on the row, never by `phone` or `name`. *Rationale:
`phone` cannot identify a customer here — 9 numbers are shared by 18 people in
the live data, which is the reason R18 was rewritten. Matching by name would
merge two people who share one.*

A re-run MUST NOT overwrite state this application owns and Interfuerza does
not: the per-channel reminder opt-outs, the deactivation timestamp, and the
vehicle collection. *Rationale: a re-import that resurrects a customer the
workshop deactivated, or silently reverses a consent decision, is worse than
no import — it undoes deliberate work with no audit and no warning.*

A row the system cannot represent MUST be SKIPPED and REPORTED, never
fabricated and never silently dropped. At minimum a row with no name, no
external identifier, or no phone in any of its phone fields MUST be skipped,
and the result MUST name each skipped customer and the reason. *Rationale:
`phone` is `NOT NULL` and R17 requires it, so the alternatives were to invent a
value or to write rows this application's own form would reject. A skip that
nobody can see is indistinguishable from data loss.*

Phone values MUST be imported verbatim, without normalisation. *Rationale: the
owner was shown the consequence and chose it — Panama numbers are 8 digits with
no country code, WhatsApp requires E.164, and so 353 of these customers cannot
receive a WhatsApp reminder. Recorded as an accepted cost, not an oversight;
changing it later is a data migration over a known column, not a code change.*

The import MUST be all-or-nothing. *Rationale: a half-imported customer list is
worse than an empty one, because staff cannot tell which half is missing.*

#### Scenarios

- GIVEN an Interfuerza customer not yet in this system WHEN staff runs the import THEN the system MUST create that `cliente` and record its external identifier
- GIVEN an already-imported customer WHEN staff runs the import a second time THEN the system MUST update that same record and MUST NOT create a second one
- GIVEN two Interfuerza customers sharing one phone number WHEN staff runs the import THEN the system MUST create both, matched by external identifier rather than conflated by phone
- GIVEN an imported customer the workshop has since deactivated WHEN staff runs the import again THEN that customer MUST remain deactivated
- GIVEN an imported customer whose WhatsApp opt-out was set locally WHEN staff runs the import again THEN that opt-out MUST survive
- GIVEN an Interfuerza row with no phone in any of its phone fields WHEN staff runs the import THEN the system MUST NOT create a `cliente` for it and MUST name it in the result with the reason
- GIVEN an Interfuerza row whose name is blank WHEN staff runs the import THEN the system MUST skip it rather than substituting any other field as the name
- GIVEN an 8-digit Interfuerza phone WHEN it is imported THEN the stored value MUST be that same string, with no country code added
- GIVEN a page of the import that fails after its retries are exhausted WHEN the run aborts THEN no customer from that run MUST remain persisted
