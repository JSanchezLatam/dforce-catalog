/**
 * workshop-feedback-round-1 PR F1. The preview on this page is only worth
 * anything if it shows the REAL workshop branding — the logo and cover photo
 * the PDF will carry — so the page has to read `workshop_config` and hand it
 * down. Nothing else here would fail if that fetch quietly disappeared: the
 * preview would keep rendering, minus the logo.
 *
 * The form is stubbed, as in `builder/page.test.tsx`: what is under test is
 * the props this Server Component hands over, not the form's markup.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkshopConfig } from "@/shared/db/schema";

const can = vi.hoisted(() => vi.fn<(user: unknown, action: string) => boolean>(() => true));
const formProps = vi.hoisted(() => vi.fn());
const WORKSHOP = { id: "singleton", name: "Dforce Car", logoR2Key: "logos/abc" } as WorkshopConfig;

vi.mock("@/modules/auth/session", () => ({
  requireSessionFromHeaders: vi.fn(async () => ({ id: "u1", role: "administrador" })),
}));
vi.mock("@/modules/auth/policy", () => ({ can }));
const COVER_ROWS = [
  { templateId: "full-cover", r2Key: "covers/full-cover/2.jpg", contentType: "image/jpeg", updatedAt: new Date() },
];
vi.mock("@/modules/template-config/service", () => ({
  getTemplateConfig: vi.fn(async () => null),
  listTemplateCoverImages: vi.fn(async () => COVER_ROWS),
}));
vi.mock("@/modules/workshop-config/service", () => ({ getWorkshopConfig: vi.fn(async () => WORKSHOP) }));
vi.mock("@/modules/template-config/TemplateConfigForm", () => ({
  TemplateConfigForm: (props: Record<string, unknown>) => {
    formProps(props);
    return null;
  },
}));

import TemplateConfigPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TemplateConfigPage — branding for the preview (PR F1)", () => {
  it("hands the form the workshop config, so the preview shows the real logo", async () => {
    render(await TemplateConfigPage());

    expect(formProps.mock.calls.at(-1)?.[0].workshopConfig).toEqual(WORKSHOP);
  });

  // A plain `Record<templateId, r2Key>`: the page is a Server Component, so
  // what crosses to the client form must be serialisable (no functions, no
  // Date-bearing rows).
  it("hands the form each template's cover key, read from template_cover_image", async () => {
    render(await TemplateConfigPage());

    expect(formProps.mock.calls.at(-1)?.[0].coverImageKeys).toEqual({ "full-cover": "covers/full-cover/2.jpg" });
  });

  it("still refuses the page to a user without template.edit", async () => {
    can.mockReturnValueOnce(false);
    render(await TemplateConfigPage());

    expect(formProps).not.toHaveBeenCalled();
  });
});
