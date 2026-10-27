import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StaleBanner } from "./StaleBanner";

const T0 = Date.parse("2026-10-26T15:00:00Z");
const MIN = 60_000;

describe("StaleBanner", () => {
  it("is hidden before the first failed poll", () => {
    const { container } = render(<StaleBanner lastOkAt={T0} failedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is hidden while less than a minute has elapsed since the last good snapshot", () => {
    const { container } = render(<StaleBanner lastOkAt={T0} failedAt={T0 + MIN - 1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reads exactly `Sin conexión · actualizado hace 1 min` (U+00B7) once a minute elapsed", () => {
    render(<StaleBanner lastOkAt={T0} failedAt={T0 + MIN} />);
    expect(screen.getByRole("status").textContent).toBe("Sin conexión · actualizado hace 1 min");
  });

  it("counts whole minutes", () => {
    render(<StaleBanner lastOkAt={T0} failedAt={T0 + 5 * MIN + 59_000} />);
    expect(screen.getByRole("status").textContent).toBe("Sin conexión · actualizado hace 5 min");
  });
});
