# Spec: technicians

New capability. A roster of the people who work orders, kept apart from login accounts, plus the `jefe_taller` role that manages it.

## ADDED Requirements

### Requirement: Technician Roster

The system MUST persist a `tecnico` table with a server-generated id, a required non-empty `nombre`, an OPTIONAL `user_id` link to `users`, and a nullable `deactivated_at` timestamp (the repository soft-delete convention; no boolean). `user_id` MUST be unique when set: one login links to at most one roster row, and a roster row links to at most one login. A roster row MUST be creatable with no login (a technician who never signs in). Roster rows MUST NEVER be deleted: no delete path exists and every foreign key to `tecnico` is `ON DELETE RESTRICT`. A deactivated technician MUST remain on every historical assignment and work line and MUST NOT be offered for new assignments.

#### Scenario: Technician without a login
- GIVEN a roster create with a name and no `user_id`
- WHEN it is saved
- THEN the row MUST exist with a null `user_id` and no `deactivated_at`

#### Scenario: One login, one roster row
- GIVEN a roster row linked to user U
- WHEN another roster row is linked to U
- THEN the system MUST refuse it with a Spanish message, and a direct insert violating uniqueness MUST be rejected by the database

#### Scenario: Name is required
- GIVEN a roster create with a blank name
- WHEN it is submitted
- THEN the system MUST refuse it with a Spanish validation error and store nothing

#### Scenario: Deactivation keeps history
- GIVEN a technician with assignments and work lines
- WHEN an admin or jefe deactivates them
- THEN `deactivated_at` MUST be set, their assignments and lines MUST remain unchanged, and they MUST NOT appear in the assignment picker

#### Scenario: No delete path
- GIVEN any roster row
- WHEN any request attempts to delete it
- THEN no such route MUST exist, and a direct delete of a row referenced by an assignment or line MUST be rejected by the database

### Requirement: Roster Backfill

The migration MUST create exactly one roster row, linked to the login, for every existing user whose role is `tecnico`, named from `users.name` (or `users.username` when `name` is null or blank), copying `users.deactivated_at` to the roster row's `deactivated_at` (verified columns in `schema.ts`: `name`, `username`, `deactivated_at`, `role`). It MUST NOT assign any existing order to anyone.

#### Scenario: Existing técnico gets a linked row
- GIVEN one existing `tecnico` user and no roster rows
- WHEN the migration runs
- THEN exactly one roster row MUST exist with `user_id` equal to that user

#### Scenario: Other roles are not backfilled
- GIVEN existing `administrador` users
- WHEN the migration runs
- THEN no roster row MUST be created for them

#### Scenario: No assignment backfill
- GIVEN the 8 existing orders
- WHEN the migration runs
- THEN no assignment row MUST exist, and an administrador or jefe MUST be able to assign open orders afterwards

### Requirement: Who Manages the Roster

An `administrador` and a `jefe_taller` MUST be able to list, create, rename and deactivate or reactivate roster rows. Only an `administrador` MUST be able to set or change a roster row's `user_id` link; a `jefe_taller` creating a row MUST NOT be able to supply a link, and a jefe request carrying `user_id` MUST be refused with 403. A `tecnico` MUST NOT read or write the roster through the roster routes (refused 403). The roster UI MUST be reachable by administrador and jefe, work at tablet and phone widths, use Spanish copy, show a success toast on every mutation, and keep every action control at 44x44 minimum.

#### Scenario: Jefe creates a roster row without a login
- GIVEN a `jefe_taller` session
- WHEN they create a technician named "Luis"
- THEN the row MUST be created with a null `user_id`

#### Scenario: Jefe cannot link a login
- GIVEN a `jefe_taller` session and an existing roster row
- WHEN they send an update carrying a `user_id`
- THEN the system MUST refuse with 403 and MUST NOT change the link

#### Scenario: Administrador links a login
- GIVEN an `administrador` session and an unlinked roster row
- WHEN they link it to an active `tecnico` user
- THEN the link MUST be saved

#### Scenario: Técnico refused
- GIVEN a `tecnico` session
- WHEN they call any roster route
- THEN the system MUST answer 403

#### Scenario: Mutations confirm
- GIVEN a successful roster create, rename, link or deactivation
- WHEN the response arrives
- THEN a Spanish success toast MUST show beside the page refresh

### Requirement: Jefe de Taller Role

The system MUST define a `jefe_taller` role holding every permission of `administrador` EXCEPT `users.manage`, `workshop.edit`, `template.edit` and `service-orders.correct`. It MUST keep, among others, `sync.manual` and `catalogs.generate`. Every route guarded by an excluded permission MUST answer a `jefe_taller` session with 403, and the corresponding navigation entries MUST NOT render for that role. Role checks that name `administrador` literally (for example photo deletion, closed-order corrections) are NOT widened to `jefe_taller` by this change. The role MUST be added to the database enum in a migration separate from any statement that uses the new value.

#### Scenario: Jefe refused on users
- GIVEN a `jefe_taller` session
- WHEN it calls any users-management route
- THEN the system MUST answer 403

#### Scenario: Jefe refused on workshop and template settings
- GIVEN a `jefe_taller` session
- WHEN it writes workshop settings or the catalog template
- THEN the system MUST answer 403

#### Scenario: Jefe cannot correct a closed order
- GIVEN a `done` order and a `jefe_taller` session
- WHEN it sends a correction, with or without any password
- THEN the system MUST refuse with 403 and MUST NOT verify the password

#### Scenario: Jefe keeps sync and catalog generation
- GIVEN a `jefe_taller` session
- WHEN it triggers a manual inventory sync or generates a catalog
- THEN the system MUST allow both

#### Scenario: Excluded entries are hidden
- GIVEN a `jefe_taller` session
- WHEN the shell navigation renders
- THEN it MUST NOT show Gestión de usuarios or the workshop and template settings entries

#### Scenario: Route-guard coverage
- GIVEN the repository's route-guard test
- WHEN a new route is added with no declared permission
- THEN the test MUST fail, and every roster, assignment and work-line route MUST be declared in it
