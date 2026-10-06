import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecordCard, RecordCardList } from "./RecordCard";

describe("RecordCardList", () => {
  it("is a list hidden from md up, carrying the given test id", () => {
    render(
      <RecordCardList testId="things-cards">
        <RecordCard>uno</RecordCard>
      </RecordCardList>,
    );

    const list = screen.getByTestId("things-cards");
    expect(list.tagName).toBe("UL");
    expect(list).toHaveClass("md:hidden");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("RecordCard", () => {
  it("with href is ONE link wrapping the whole content", () => {
    render(
      <RecordCardList testId="c">
        <RecordCard href="/x/1">
          <span>Pérez</span>
          <span>#abcd1234</span>
        </RecordCard>
      </RecordCardList>,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/x/1");
    expect(link).toHaveTextContent("Pérez");
    expect(link).toHaveTextContent("#abcd1234");
  });

  it("renders the action slot outside the link, and no checkbox", () => {
    render(
      <RecordCardList testId="c">
        <RecordCard href="/x/1" action={<button type="button">Acción</button>}>
          cuerpo
        </RecordCard>
      </RecordCardList>,
    );

    const link = screen.getByRole("link");
    const action = screen.getByRole("button", { name: "Acción" });
    expect(link).not.toContainElement(action);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("without href renders no link", () => {
    render(
      <RecordCardList testId="c">
        <RecordCard>cuerpo</RecordCard>
      </RecordCardList>,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("cuerpo")).toBeInTheDocument();
  });
});
