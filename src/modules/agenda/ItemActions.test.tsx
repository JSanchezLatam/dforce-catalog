import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { makeItem } from "./items.fixture";
import { ItemActions } from "./ItemActions";

afterEach(cleanup);
const names = () => screen.queryAllByRole("button").map((b) => b.textContent);

describe("ItemActions", () => {
  it("offers both actions to a Vencida booked item, only Reprogramar to a booked one, none to a muted one", () => {
    const { rerender } = render(<ItemActions item={makeItem({ overdue: true })} />);
    expect(names()).toEqual(["Reprogramar", "No se presentó"]);
    rerender(<ItemActions item={makeItem()} />);
    expect(names()).toEqual(["Reprogramar"]);
    rerender(<ItemActions item={makeItem({ muted: true, status: "open" })} />);
    expect(names()).toEqual([]);
  });
});
