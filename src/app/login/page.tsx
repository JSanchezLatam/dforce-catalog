import type { CSSProperties } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { LoginForm } from "@/modules/auth/LoginForm";
import { LoginThemeToggle } from "@/modules/auth/LoginThemeToggle";

import heroImage from "./assets/login-hero.jpg";
import logo from "./assets/dforce-logo.png";

const loginBrandStyle = {
  // Login-only brand accent sampled from the company logo. Do not promote to globals.css.
  "--login-brand": "hsl(5 85% 45%)",
  "--login-brand-hover": "hsl(5 85% 39%)",
  "--login-brand-foreground": "white",
} as CSSProperties;

export default function LoginPage() {
  return (
    <main
      className="grid min-h-dvh grid-cols-1 bg-muted text-foreground lg:grid-cols-2"
      style={loginBrandStyle}
    >
      <LoginThemeToggle />
      <section className="flex flex-col items-center px-5 py-10 sm:px-8 lg:px-12">
        <Card className="my-auto w-full max-w-[400px] rounded-3xl border border-border bg-card py-0 shadow-[0_24px_70px_rgb(15_23_42_/_0.16)] ring-0 dark:shadow-[0_28px_80px_rgb(0_0_0_/_0.36)]">
          <CardContent className="flex flex-col items-center px-8 py-9 sm:px-9">
            {/* eslint-disable-next-line @next/next/no-img-element --
                Plain <img> deliberately. This repo uses `next/image` nowhere and
                `next.config.ts` declares no `images` block, so adopting it here
                would be a first-time config change inside a restyle. Both assets
                are static ES imports already hashed and served from
                `/_next/static/media`, and both carry explicit width/height, so
                the CLS the rule warns about is handled.

                On weight: the logo is 400x145 for a 200px slot — 2x retina, so
                it is sized for what it renders. The hero is not: it is a
                736x981 placeholder that upscales on a wide screen, and it will
                be replaced with a real photo rather than resampled. */}
            <img
              src={logo.src}
              width={logo.width}
              height={logo.height}
              alt="Dforce Car Audio"
              className="mb-6 h-auto w-[200px] max-w-full"
            />
            <div className="mb-7 text-center">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Bienvenido de vuelta</h1>
              <p className="mt-2 text-sm text-muted-foreground">Inicia sesión para continuar</p>
            </div>
            <LoginForm />
          </CardContent>
        </Card>
        {/* In flow, not `absolute bottom-5`. Pinned to the bottom it overlapped
            the card by 19px once the panel started hugging its content at a
            ~500px viewport — measured. `my-auto` on the card centres it while
            there is room and collapses when there is not, so these sit under
            the card instead of on top of it. */}
        <div className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
          <p>Desarrollado por Jorge Sanchez</p>
          <p className="opacity-75">Versión 1.0 · Septiembre 2026</p>
        </div>
      </section>
      <section className="relative hidden overflow-hidden lg:block" aria-hidden="true">
        {/* Out of flow (`absolute inset-0`), like the gradient below it, because
            `min-h-dvh` on the grid makes the row content-sized above its floor and
            this <img> has an intrinsic size. In flow it therefore sized the row
            itself, at its own 736:981 aspect ratio, and `size-full` then resolved
            against the row it had just created: measured 960px tall in a 900px
            viewport, scrolling a desktop that had room. Out of flow it sizes from
            the section instead. `size-full` stays — `inset-0` on its own does not
            stretch a replaced element. */}
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
          <p className="mt-3 text-[15px] leading-6 text-white/75">
            Gestión de órdenes, clientes y catálogo para el taller.
          </p>
        </div>
      </section>
    </main>
  );
}
