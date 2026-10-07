# Product

<!-- impeccable:product-schema 1 -->

> Written 2026-10-07 from the repository and the owner's recorded decisions; the
> owner approved inferring it instead of an interview. Facts are from code,
> `AGENTS.md`, `openspec/specs/` and owner decisions unless marked *(inferred)*.

## Platform

web

## Users

- **Administrador (the owner).** Runs DForce Car Audio, a car-audio and
  electrical workshop in Panamá. Manages customers, service orders, the
  inventory catalog, users and settings; corrects closed orders with his
  password.
- **Jefe de taller.** Runs the floor: creates orders, assigns technicians,
  reviews work, closes orders. Everything the owner does except users,
  workshop/template settings, closed-order corrections and photo deletion.
- **Técnico.** Works assigned orders from a phone or tablet in the bay: starts
  them, logs work lines (minutes), photographs reception, marks "Mi parte
  lista". Sees only orders assigned to them.
- **The workshop's own client** asked for the metrics dashboard; technician
  productivity was their most-requested view.

## Product Purpose

An internal workshop system: customer and vehicle records, service orders from
reception to close (with photos, readiness and audited corrections), renewal
reminders for plates and insurance, a product catalog generator synced from
Interfuerza, and — next — metrics so the owner sees throughput and technician
productivity. Success is the workshop running its day in it without paper.

## Operating Context

- One machine in the workshop serves the app over plain HTTP on the LAN
  (`http://192.168.x.x:3000`); everyone else opens it from their own device.
  It is an insecure browser context for every user but the server's.
- Used heavily from tablets and phones in the bay, often with dirty hands
  *(inferred from the 44px touch-target rule)*; desktop at the front desk.
- Several people look at the same data at once from different machines.
- Deployment target is a Windows PC (`standalone.ps1`).

## Capabilities and Constraints

- Stack: Next.js 16 App Router, React 19, TypeScript, Drizzle + Postgres,
  shadcn + Base UI, Tailwind v4. Charts: Arc UI (`@uiarc/*`, owner's choice).
- UI copy is Spanish (rioplatense voseo); code is English.
- Every mutation confirms with a toast; action controls are at least 44×44.
- No prices or revenue anywhere until v2 (no price data exists).
- Months and dates are the workshop's local time (America/Panama).
- Undecided: whether the productivity definition (closed orders + hours logged)
  came from the client; the owner will confirm with them.

## Brand Commitments

- Name: "DForce Car Audio". Workshop logo is configurable content
  (`WorkshopLogo`).
- Theme: shadcn stock neutral palette, light and dark, toggled with
  `next-themes`. It flipped twice before (Kanagawa Dragon, violet/gold); do not
  change colors without reading `src/app/globals.css` first.

## Evidence on Hand

- Real data lives in the workshop database: ~384 customers, a 699-row catalog,
  few service orders so far. The dev database holds QA rows only.
- No testimonials, benchmarks or marketing claims exist; do not invent them.

## Product Principles

1. The bay comes first: every screen must work one-handed on a phone or tablet.
2. A number the owner acts on must be exact and readable without a chart.
3. Never show a técnico what is not theirs; scope comes from the session, not
   the URL.
4. Confirm every change; refuse with a reason in Spanish, never a code.

## Accessibility & Inclusion

44×44 minimum action targets on touch; content readable at 390px without
horizontal scroll; both light and dark themes legible; reduced motion
respected.
