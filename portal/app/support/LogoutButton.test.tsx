// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogoutButton } from "./LogoutButton";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

const fetchMock = vi.fn();
beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
  fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(cleanup);

describe("Salir", () => {
  it("POSTs to the logout route, then goes to the login page", async () => {
    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Salir" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/support/login"));
    expect(fetchMock).toHaveBeenCalledWith("/api/support/logout", { method: "POST" });
    expect(refresh).toHaveBeenCalled();
  });

  it("stays put and says so when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Salir" }));
    expect((await screen.findByRole("alert")).textContent).toBe("No se pudo cerrar la sesión. Probá de nuevo.");
    expect(replace).not.toHaveBeenCalled();
  });
});
