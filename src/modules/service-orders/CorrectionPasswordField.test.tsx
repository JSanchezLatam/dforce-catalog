/**
 * The re-authentication field shared by the correction form and the photo
 * confirmations. It is CONTROLLED: the owner holds the value, so clearing it on
 * close is the owner's job (pinned in `ServiceOrderForm.test.tsx`).
 * See `.claude/skills/component-testing/SKILL.md` for why this is `.test.tsx`.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CorrectionPasswordField } from "./CorrectionPasswordField";

describe("CorrectionPasswordField", () => {
  it("is a required password input labelled 'Tu contraseña' that offers the saved credential", () => {
    render(<CorrectionPasswordField value="" onChange={() => {}} />);

    const input = screen.getByLabelText("Tu contraseña");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "current-password");
    expect(input).toBeRequired();
  });

  it("reports what is typed and shows the controlled value", () => {
    const onChange = vi.fn();
    render(<CorrectionPasswordField value="abc" onChange={onChange} />);

    expect(screen.getByLabelText("Tu contraseña")).toHaveValue("abc");
    fireEvent.change(screen.getByLabelText("Tu contraseña"), { target: { value: "abcd" } });
    expect(onChange).toHaveBeenCalledWith("abcd");
  });

  it("shows an error inline and ties it to the input", () => {
    render(<CorrectionPasswordField value="" onChange={() => {}} error="Contraseña incorrecta" />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Contraseña incorrecta");
    const input = screen.getByLabelText("Tu contraseña");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
  });

  it("shows no alert when there is no error", () => {
    render(<CorrectionPasswordField value="" onChange={() => {}} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tu contraseña")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("keeps two instances' ids apart", () => {
    render(
      <>
        <CorrectionPasswordField value="" onChange={() => {}} />
        <CorrectionPasswordField value="" onChange={() => {}} />
      </>,
    );

    const [a, b] = screen.getAllByLabelText("Tu contraseña");
    expect(a.id).not.toBe(b.id);
  });
});
