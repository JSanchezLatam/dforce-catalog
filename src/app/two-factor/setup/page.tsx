import type { CSSProperties } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { landingPathFor } from "@/modules/auth/landing";
import { LoginThemeToggle } from "@/modules/auth/LoginThemeToggle";
import { twoFactorAvailable } from "@/modules/auth/enrolment";
import { ROLE_LABELS } from "@/modules/auth/roles";
import { secondFactorSession } from "@/modules/auth/second-factor";
import { SESSION_COOKIE } from "@/modules/auth/session";
import { TwoFactorSetup } from "@/modules/auth/TwoFactorSetup";

import heroImage from "../../login/assets/login-hero.jpg";
import logo from "../../login/assets/dforce-logo.png";

const loginBrandStyle = {
  "--login-brand": "var(--primary)",
  "--login-brand-hover": "var(--primary-hover)",
  "--login-brand-foreground": "white",
} as CSSProperties;

/**
 * The mandatory 2FA setup (T8b, L41, mockup `s3`), outside the `(app)` group
 * like `/two-factor`: the proxy confines an `enroll` session here. The proxy
 * forwards identity on this path whatever the session's state, so the state
 * is read from the database by the cookie's token.
 */
export default async function TwoFactorSetupPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await secondFactorSession(token) : null;
  if (session && session.pending === null) redirect(landingPathFor(session.role));
  if (!session || session.pending !== "enroll") redirect("/login");

  return (
    <main
      className="grid min-h-dvh grid-cols-1 bg-muted dark:bg-background text-foreground lg:grid-cols-2"
      style={loginBrandStyle}
    >
      <LoginThemeToggle />
      <section className="flex flex-col items-center px-5 py-10 sm:px-8 lg:px-12">
        <Card className="my-auto w-full max-w-[460px] rounded-3xl border border-border bg-card py-0 shadow-[0_24px_70px_rgb(15_23_42_/_0.16)] ring-0 dark:shadow-[0_28px_80px_rgb(0_0_0_/_0.36)]">
          <CardContent className="flex flex-col items-center px-8 py-9 sm:px-9">
            {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>, as on /login (see the note there). */}
            <img
              src={logo.src}
              width={logo.width}
              height={logo.height}
              alt="Dforce Car Audio"
              className="mb-6 h-auto w-[200px] max-w-full"
            />
            <TwoFactorSetup roleLabel={ROLE_LABELS[session.role]} available={twoFactorAvailable()} />
          </CardContent>
        </Card>
      </section>
      <section className="relative hidden overflow-hidden lg:block" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- see the note on the logo above. */}
        <img
          src={heroImage.src}
          width={heroImage.width}
          height={heroImage.height}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.85)_0%,rgba(0,0,0,0.55)_30%,rgba(0,0,0,0.10)_65%,rgba(0,0,0,0.25)_100%)]" />
        <div className="absolute bottom-10 left-10 max-w-[42ch] text-white">
          <h2 className="text-[32px] font-bold leading-tight tracking-tight">
            El trabajo bien hecho
            <br />
            se nota.
          </h2>
        </div>
      </section>
    </main>
  );
}
