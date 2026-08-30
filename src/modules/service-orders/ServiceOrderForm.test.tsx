/**
 * Component tests for `ServiceOrderForm` (jsdom, see AGENTS.md's Component
 * testing section — `.test.tsx` routes to the `jsdom` project). Submit is
 * gated on `clienteId` in create mode, so the seeding of that field from the
 * `selectedCustomer` prop is the behaviour worth proving here.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ClienteListItem } from "@/modules/customers/queries";
import { ServiceOrderForm } from "./ServiceOrderForm";

const CUSTOMER: ClienteListItem = {
  id: "c-preseleccionado",
  name: "Ya Elegido",
  phone: "50761111111",
  email: null,
  plates: ["ABC111"],
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /nueva orden de servicio/i }));
}

describe("ServiceOrderForm", () => {
  it("seeds clienteId from selectedCustomer so a pre-picked customer can be submitted", () => {
    render(<ServiceOrderForm products={[]} selectedCustomer={CUSTOMER} canCreateCustomer={false} />);
    openDialog();

    expect(screen.getByText("Ya Elegido")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar" })).not.toBeDisabled();
  });

  it("keeps submit disabled in create mode when no customer was pre-picked", () => {
    render(<ServiceOrderForm products={[]} canCreateCustomer={false} />);
    openDialog();

    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });
});
