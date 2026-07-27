import { describe, expect, it, vi } from "vitest";

import { withAuthorization } from "./guard";

describe("withAuthorization() — 403 gate", () => {
  it("returns 403 JSON before invoking handler when can() is false", async () => {
    const handler = vi.fn().mockResolvedValue(new Response("ok"));
    const guarded = withAuthorization("catalogs.generate", handler);

    const request = new Request("http://localhost/generate", {
      headers: { "x-user-id": "user-1", "x-user-role": "tecnico" },
    });
    const response = await guarded(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("invokes handler normally when can() is true", async () => {
    const handler = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const guarded = withAuthorization("customers.read", handler);

    const request = new Request("http://localhost/customers", {
      headers: { "x-user-id": "user-1", "x-user-role": "tecnico" },
    });
    const response = await guarded(request);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});
