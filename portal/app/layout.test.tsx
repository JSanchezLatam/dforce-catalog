import { describe, expect, it } from "vitest";

import RootLayout from "./layout";

describe("RootLayout", () => {
  it("declares the document Spanish and opts out of browser auto-translation", () => {
    const html = RootLayout({ children: null });
    expect(html.type).toBe("html");
    expect(html.props.lang).toBe("es");
    expect(html.props.translate).toBe("no");
  });
});
