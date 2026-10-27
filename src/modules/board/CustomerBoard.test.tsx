import { act, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerBoard } from "./CustomerBoard";
import type { CustomerRow, CustomerSnapshot } from "./shape";

const row = (plate: string, status: CustomerRow["status"], make: string | null = "Toyota", model: string | null = "Hilux") => ({ plate, make, model, status });
const SNAPSHOT: CustomerSnapshot = {
  generatedAt: "2026-10-26T15:00:00.000Z",
  rows: [row("AB1234", "Recibida"), row("CD5678", "En proceso", null, null), row("EF9012", "Terminada", "Kia", "Rio")],
};

describe("CustomerBoard", () => {
  it("renders three columns Recibida / En proceso / Terminada with each plate unmasked in its own column", () => {
    render(<CustomerBoard initial={SNAPSHOT} />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Recibida", "En proceso", "Terminada"]);
    const col = (name: string) => within(screen.getByRole("region", { name }));
    expect(col("Recibida").getByText("AB1234")).toBeInTheDocument();
    expect(col("En proceso").getByText("CD5678")).toBeInTheDocument();
    expect(col("Terminada").getByText("EF9012")).toBeInTheDocument();
    expect(col("Terminada").getByText("Kia Rio")).toBeInTheDocument();
  });

  it("carries no control: no button, form, link or input", () => {
    const { container } = render(<CustomerBoard initial={SNAPSHOT} />);
    expect(container.querySelector("button, form, a, input, select, textarea")).toBeNull();
  });

  it("clips a long column with `+N más` instead of overflowing", () => {
    const many = { ...SNAPSHOT, rows: Array.from({ length: 15 }, (_, i) => row(`P${String(i).padStart(4, "0")}`, "En proceso")) };
    render(<CustomerBoard initial={many} />);

    const col = within(screen.getByRole("region", { name: "En proceso" }));
    expect(col.getAllByRole("listitem")).toHaveLength(12);
    expect(col.getByText("+3 más")).toBeInTheDocument();
  });

  describe("live polling", () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
      fetchMock.mockReset();
      vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("polls /api/board/clientes and shows the new rows", async () => {
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ generatedAt: "2026-10-26T15:00:30.000Z", rows: [row("ZZ0001", "Recibida")] }), { status: 200 }));
      render(<CustomerBoard initial={SNAPSHOT} />);

      await act(() => vi.advanceTimersByTimeAsync(30_000));

      expect(fetchMock).toHaveBeenCalledWith("/api/board/clientes", { cache: "no-store" });
      expect(screen.getByText("ZZ0001")).toBeInTheDocument();
      expect(screen.queryByText("AB1234")).not.toBeInTheDocument();
    });

    it("keeps every row and shows the banner once a minute has passed without a good poll", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      render(<CustomerBoard initial={SNAPSHOT} />);

      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(30_000));

      expect(screen.getByRole("status").textContent).toBe("Sin conexión · actualizado hace 1 min");
      expect(screen.getByText("AB1234")).toBeInTheDocument();
    });
  });
});

describe("insecure-context rule (the workshop is served over plain HTTP on the LAN)", () => {
  const FILES = ["useBoardSnapshot.ts", "StaleBanner.tsx", "CustomerBoard.tsx"];
  const FORBIDDEN = /randomUUID|crypto\.subtle|wakeLock|serviceWorker|clipboard/;

  it.each(FILES)("%s uses no secure-context-only API", (file) => {
    expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toMatch(FORBIDDEN);
  });

  it.each(FILES)("%s imports only TYPES from the server-only mappers (shape pulls node:crypto)", (file) => {
    const imports = readFileSync(new URL(file, import.meta.url), "utf8").match(/^import .*$/gm) ?? [];
    for (const line of imports.filter((l) => /shape|snapshot|queries|node:crypto|portal-sync/.test(l))) {
      expect(line).toMatch(/^import type /);
    }
  });
});
