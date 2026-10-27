import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DayView } from "./DayView";
import { makeItem } from "./items.fixture";
import { ItemActions } from "./ItemActions";
import { VencidasPanel } from "./VencidasPanel";

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

  it("DayView renders the actions on a booked chip", () => {
    render(<DayView items={[makeItem()]} />);
    expect(screen.getByRole("button", { name: "Reprogramar" })).toBeInTheDocument();
  });

  it("VencidasPanel renders what the actions slot returns", () => {
    render(<VencidasPanel items={[makeItem({ overdue: true })]} total={1} truncated={false} actions={(item) => <ItemActions item={item} />} />);
    expect(screen.getByRole("button", { name: "No se presentó" })).toBeInTheDocument();
  });
});
