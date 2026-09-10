/**
 * Component tests for the shared make/model control (design.md D14–D17).
 *
 * Base UI selects are driven the way `UserForm.test.tsx:39-42` already does:
 * click the label, then `await screen.findByRole("option", { name })` — never
 * by typing into them.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OTHER } from "./vehicle-catalog";
import { VehicleMakeModelFields } from "./VehicleMakeModelFields";

/**
 * `VehicleMakeModelFields` is controlled: it renders exactly what `make`/
 * `model` say and relies on its caller to hold the state. A free-text
 * keystroke test needs that caller loop closed — without it a controlled
 * `Input` whose `value` prop never advances gets reset to the stale value
 * between keystrokes, and `userEvent.type` only ever sees the single most
 * recent character. Both `VehicleQuickForm` and `CustomerForm` close this
 * loop themselves; this harness stands in for either.
 */
function Harness({ onChange }: { onChange: (next: { make: string; model: string }) => void }) {
  const [state, setState] = useState({ make: "", model: "" });
  return (
    <VehicleMakeModelFields
      idPrefix="v1"
      make={state.make}
      model={state.model}
      onChange={(next) => {
        setState(next);
        onChange(next);
      }}
    />
  );
}

async function chooseMake(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByLabelText("Marca"));
  await user.click(await screen.findByRole("option", { name: label }));
}

async function chooseModel(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByLabelText("Modelo"));
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("VehicleMakeModelFields", () => {
  it("the Marca select offers every catalog make plus Otro", async () => {
    const user = userEvent.setup();
    render(<VehicleMakeModelFields idPrefix="v1" make="" model="" onChange={vi.fn()} />);

    await user.click(screen.getByLabelText("Marca"));

    expect(await screen.findByRole("option", { name: "Toyota" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Volvo" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Otro" })).toBeInTheDocument();
  });

  it("the Modelo select offers only the selected make's models, plus Otro", async () => {
    const user = userEvent.setup();
    render(<VehicleMakeModelFields idPrefix="v1" make="Toyota" model="" onChange={vi.fn()} />);

    await user.click(screen.getByLabelText("Modelo"));

    expect(await screen.findByRole("option", { name: "Hilux" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Otro" })).toBeInTheDocument();
    // A Kia model must never appear under Toyota.
    expect(screen.queryByRole("option", { name: "Sportage" })).not.toBeInTheDocument();
  });

  it("choosing Otro in Marca reveals a free-text input and emits what staff type, never the string Otro", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await chooseMake(user, "Otro");
    const makeInput = screen.getByLabelText("Especificá la marca");
    expect(makeInput).toBeInTheDocument();

    await user.type(makeInput, "Hino");

    for (const call of onChange.mock.calls) {
      expect(call[0].make).not.toBe(OTHER); // the sentinel, not its label — the label can never be stored
    }
    expect(onChange).toHaveBeenLastCalledWith({ make: "Hino", model: "" });
  });

  it("Otro is not a dead end: picking a catalog make afterward hides the input and stores the catalog make", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<VehicleMakeModelFields idPrefix="v1" make="" model="" onChange={onChange} />);

    await chooseMake(user, "Otro");
    expect(screen.getByLabelText("Especificá la marca")).toBeInTheDocument();

    await chooseMake(user, "Kia");
    expect(onChange).toHaveBeenLastCalledWith({ make: "Kia", model: "" });

    // The parent is the source of truth; re-render with the emitted value to
    // confirm the free-text input actually disappears once `make` reflects it.
    rerender(<VehicleMakeModelFields idPrefix="v1" make="Kia" model="" onChange={onChange} />);
    expect(screen.queryByLabelText("Especificá la marca")).not.toBeInTheDocument();
  });

  /**
   * The DEFAULT state of every new vehicle row on both write paths, and the
   * case the first version missed: with no make chosen there is no model list,
   * so a combobox would open showing `Otro` as its ONLY option — the control
   * D14 calls worse than the text box it replaced. Keyed off "is there a list"
   * rather than "is the make free text", which subsumes both.
   */
  it("with no Marca chosen yet, Modelo is a textbox — never a select holding only Otro", () => {
    render(<VehicleMakeModelFields idPrefix="v1" make="" model="" onChange={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "Modelo" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Modelo" })).not.toBeInTheDocument();
  });

  it("with Marca in escape mode, Modelo is a plain textbox, not a combobox", async () => {
    const user = userEvent.setup();
    // Through the `Harness` and starting on a real make, so this covers the
    // ESCAPE path rather than the empty one the case above owns. A bare render
    // cannot: the component is controlled, so a fixed `make` prop never moves.
    render(<Harness onChange={vi.fn()} />);
    await chooseMake(user, "Toyota");

    await chooseMake(user, "Otro");

    expect(screen.getByRole("textbox", { name: "Modelo" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Modelo" })).not.toBeInTheDocument();
  });

  describe("the never-blank rule (D15) — a stored value outside the catalog renders as-is", () => {
    it("an unknown stored make mounts in escape mode showing that value", () => {
      render(<VehicleMakeModelFields idPrefix="v1" make="Hino" model="" onChange={vi.fn()} />);

      expect(screen.getByRole("combobox", { name: "Marca" })).toHaveTextContent("Otro");
      expect(screen.getByLabelText("Especificá la marca")).toHaveValue("Hino");
    });

    it("a catalog make with an unknown stored model mounts with the make selected and the model as text", () => {
      render(<VehicleMakeModelFields idPrefix="v1" make="Toyota" model="Coaster" onChange={vi.fn()} />);

      expect(screen.getByRole("combobox", { name: "Marca" })).toHaveTextContent("Toyota");
      expect(screen.getByRole("combobox", { name: "Modelo" })).toHaveTextContent("Otro");
      expect(screen.getByLabelText("Especificá el modelo")).toHaveValue("Coaster");
    });

    it("mounting emits no onChange at all — the case a create-path-only test never catches", () => {
      const onChange = vi.fn();
      render(<VehicleMakeModelFields idPrefix="v1" make="Hino" model="" onChange={onChange} />);

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("the reset (D16) — changing the make clears the model", () => {
    it("changing the make empties the model and re-lists the new make's models", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { rerender } = render(
        <VehicleMakeModelFields idPrefix="v1" make="Toyota" model="Hilux" onChange={onChange} />,
      );

      await chooseMake(user, "Kia");
      expect(onChange).toHaveBeenLastCalledWith({ make: "Kia", model: "" });

      rerender(<VehicleMakeModelFields idPrefix="v1" make="Kia" model="" onChange={onChange} />);
      await user.click(screen.getByLabelText("Modelo"));
      expect(await screen.findByRole("option", { name: "Sportage" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Hilux" })).not.toBeInTheDocument();
    });

    /**
     * Through the `Harness`, not a bare render. The component is CONTROLLED,
     * so a fixed `model=""` prop never advances — typing into the escape input
     * changed nothing, and the assertion was satisfied by the INITIAL value
     * rather than by the reset. Review measured it: the D16 mutation left this
     * test green while its sibling went red, so the spec scenario "switching
     * make drops a free-text model too" had no coverage at all.
     */
    it("changing the make also clears a free-text model", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);

      await chooseMake(user, "Toyota");
      await chooseModel(user, "Otro");
      const modelInput = screen.getByLabelText("Especificá el modelo");
      await user.type(modelInput, "Coaster");

      await chooseMake(user, "Kia");
      expect(onChange).toHaveBeenLastCalledWith({ make: "Kia", model: "" });
    });

    it("mounting with a stored make and model empties nothing", () => {
      render(<VehicleMakeModelFields idPrefix="v1" make="Toyota" model="Hilux" onChange={vi.fn()} />);

      expect(screen.getByRole("combobox", { name: "Modelo" })).toHaveTextContent("Hilux");
    });
  });
});
