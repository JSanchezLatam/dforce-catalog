/**
 * Ley 81 consent control on the customer detail view (customer-portal WU1).
 * Rendered inside the REAL `ToastProvider`: the toast is a portal on
 * `document.body`, so the confirmation is asserted as text the operator reads.
 */
import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/shared/ui/ToastProvider";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// `undefined` = the real SHOW_CONSENT_CLAUSE, so the default-state test reads the shipped value.
const clauseFlag = vi.hoisted(() => ({ show: undefined as boolean | undefined }));
vi.mock("./consent-clause", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./consent-clause")>();
  return {
    ...actual,
    get SHOW_CONSENT_CLAUSE() {
      return clauseFlag.show ?? actual.SHOW_CONSENT_CLAUSE;
    },
  };
});

import { CustomerConsentPanel } from "./CustomerConsentPanel";

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: ToastProvider });

type FetchArgs = [string, RequestInit];

function mockFetch(impl: () => unknown) {
  const fetchMock = vi.fn<(...args: FetchArgs) => unknown>(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Wire shape of POST /api/customers/[id]/consent: `recordedAt` is an ISO string.
const ok = () => ({ ok: true, status: 200, json: async () => ({ changed: true, consent: null }) });
const reply = (status: number) => () => ({ ok: false, status, json: async () => ({}) });

const granted = { granted: true, recordedByName: "Ana Admin", recordedAtLabel: "7/10/2026, 10:30:00" };
const revoked = { granted: false, recordedByName: "Beto Jefe", recordedAtLabel: "8/10/2026, 9:00:00" };

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
  clauseFlag.show = undefined;
});

const saveButton = () => screen.getByRole("button", { name: "Guardar consentimiento" });

describe("CustomerConsentPanel", () => {
  it("states plainly that no consent is recorded", () => {
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={null} />);

    expect(screen.getByText("Sin consentimiento registrado.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Consentimiento de datos (Ley 81)" })).not.toBeChecked();
  });

  it("shows who recorded a grant and when, with the box ticked", () => {
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={granted} />);

    expect(screen.getByText("Consentimiento otorgado por Ana Admin el 7/10/2026, 10:30:00")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Consentimiento de datos (Ley 81)" })).toBeChecked();
  });

  it("shows a revocation as revoked, unticked, with who and when", () => {
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={revoked} />);

    expect(screen.getByText("Consentimiento revocado por Beto Jefe el 8/10/2026, 9:00:00")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Consentimiento de datos (Ley 81)" })).not.toBeChecked();
  });

  it("still states the grant when the recording user no longer exists", () => {
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={{ ...granted, recordedByName: null }} />);

    expect(screen.getByText("Consentimiento otorgado el 7/10/2026, 10:30:00")).toBeInTheDocument();
  });

  it("starts the clause with the provisional-text banner when SHOW_CONSENT_CLAUSE is on", () => {
    clauseFlag.show = true;
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={null} />);

    const clause = screen.getByTestId("consent-clause");
    expect(clause.textContent?.startsWith("Texto provisorio — pendiente de revisión legal")).toBe(true);
    expect(clause.textContent).toMatch(/fuera de Panamá/);
  });

  it("hides the provisional clause by default but keeps the status, checkbox and save button", () => {
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={granted} />);

    expect(screen.queryByTestId("consent-clause")).not.toBeInTheDocument();
    expect(screen.queryByText("Texto provisorio — pendiente de revisión legal")).not.toBeInTheDocument();
    expect(screen.getByText("Consentimiento otorgado por Ana Admin el 7/10/2026, 10:30:00")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Consentimiento de datos (Ley 81)" })).toBeChecked();
    expect(saveButton()).toBeInTheDocument();
  });

  it("offers no checkbox and no save button without the grant", () => {
    render(<CustomerConsentPanel clienteId="c1" canRecord={false} consent={granted} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Consentimiento otorgado por Ana Admin el 7/10/2026, 10:30:00")).toBeInTheDocument();
  });

  it("explains the frozen state for a deactivated customer instead of offering controls", () => {
    render(<CustomerConsentPanel clienteId="c1" canRecord={false} deactivated consent={granted} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.getByText("El consentimiento no se puede cambiar mientras el cliente está desactivado."),
    ).toBeInTheDocument();
  });

  it("keeps save disabled and sends nothing until the checkbox changes", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(ok);
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={granted} />);

    expect(saveButton()).toBeDisabled();
    await user.click(saveButton());
    expect(fetchMock).not.toHaveBeenCalled();

    // Ticking and unticking back is not a change either.
    const box = screen.getByRole("checkbox", { name: "Consentimiento de datos (Ley 81)" });
    await user.click(box);
    await user.click(box);
    expect(saveButton()).toBeDisabled();
  });

  it("sends granted:true when a ticked box is saved, then says so and refreshes", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(ok);
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={null} />);

    await user.click(screen.getByRole("checkbox", { name: "Consentimiento de datos (Ley 81)" }));
    await user.click(saveButton());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/customers/c1/consent");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ granted: true });
    expect(await screen.findByText("Consentimiento registrado")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("sends granted:false when a granted consent is unticked and saved", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(ok);
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={granted} />);

    await user.click(screen.getByRole("checkbox", { name: "Consentimiento de datos (Ley 81)" }));
    await user.click(saveButton());

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ granted: false });
    expect(await screen.findByText("Consentimiento revocado")).toBeInTheDocument();
  });

  it("reports a request that changed nothing as already in place, not as a new record", async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ ok: true, status: 200, json: async () => ({ changed: false, consent: null }) }));
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={null} />);

    await user.click(screen.getByRole("checkbox", { name: "Consentimiento de datos (Ley 81)" }));
    await user.click(saveButton());

    expect(await screen.findByText("El consentimiento ya estaba registrado")).toBeInTheDocument();
    expect(screen.queryByText("Consentimiento registrado")).not.toBeInTheDocument();
  });

  it("keeps the confirmation and blames nobody when the refresh itself throws", async () => {
    const user = userEvent.setup();
    mockFetch(ok);
    const boom = new Error("refresh blew up");
    refresh.mockImplementationOnce(() => {
      throw boom;
    });

    // The throw escapes the handler on purpose (see CustomerActivationButton.test).
    const escaped: unknown[] = [];
    const capture = (reason: unknown) => escaped.push(reason);
    process.on("unhandledRejection", capture);
    try {
      render(<CustomerConsentPanel clienteId="c1" canRecord consent={null} />);
      await user.click(screen.getByRole("checkbox", { name: "Consentimiento de datos (Ley 81)" }));
      await user.click(saveButton());

      expect(await screen.findByText("Consentimiento registrado")).toBeInTheDocument();
      await vi.waitFor(() => expect(escaped).toContain(boom));
    } finally {
      process.off("unhandledRejection", capture);
    }

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an inline error, no toast and no refresh when the server refuses", async () => {
    const user = userEvent.setup();
    mockFetch(reply(500));
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={null} />);

    await user.click(screen.getByRole("checkbox", { name: "Consentimiento de datos (Ley 81)" }));
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo registrar el consentimiento.");
    expect(screen.queryByText("Consentimiento registrado")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();
  });

  it("names the deactivated customer when the server answers 409", async () => {
    const user = userEvent.setup();
    mockFetch(reply(409));
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={null} />);

    await user.click(screen.getByRole("checkbox", { name: "Consentimiento de datos (Ley 81)" }));
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El cliente está desactivado; no se puede cambiar el consentimiento.",
    );
  });

  it("shows the same inline error when the request never completes", async () => {
    const user = userEvent.setup();
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={null} />);

    await user.click(screen.getByRole("checkbox", { name: "Consentimiento de datos (Ley 81)" }));
    await user.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo registrar el consentimiento.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("gives the save button a 44px hit target", () => {
    render(<CustomerConsentPanel clienteId="c1" canRecord consent={null} />);

    expect(saveButton()).toHaveClass("min-h-11", "min-w-11");
  });
});

describe("CustomerConsentPanel — Generar nuevo código (customer-portal WU2)", () => {
  const rotate = () => screen.queryByRole("button", { name: "Generar nuevo código" });

  it("is offered to a user who may rotate, for a customer with current consent", () => {
    render(<CustomerConsentPanel clienteId="c1" canRecord canRotate consent={granted} />);

    expect(rotate()).toBeInTheDocument();
  });

  it("is not offered without the rotate grant, even with current consent", () => {
    render(<CustomerConsentPanel clienteId="c1" canRecord canRotate={false} consent={granted} />);

    expect(rotate()).not.toBeInTheDocument();
  });

  it("is not offered when the latest consent is a revocation, or when there is none", () => {
    const { unmount } = render(<CustomerConsentPanel clienteId="c1" canRecord canRotate consent={revoked} />);
    expect(rotate()).not.toBeInTheDocument();
    unmount();

    render(<CustomerConsentPanel clienteId="c1" canRecord canRotate consent={null} />);
    expect(rotate()).not.toBeInTheDocument();
  });

  it("is not offered for a deactivated customer", () => {
    render(<CustomerConsentPanel clienteId="c1" canRecord={false} canRotate deactivated consent={granted} />);

    expect(rotate()).not.toBeInTheDocument();
  });
});
