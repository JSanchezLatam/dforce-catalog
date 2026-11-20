import { describe, expect, it } from "vitest";

import { describeAttempt, parseAccessLogFilters } from "./access-log";
import { originOf } from "./client-ip";

describe("parseAccessLogFilters", () => {
  it("shows every login and result of the last 7 days by default", () => {
    expect(parseAccessLogFilters({})).toEqual({ days: 7 });
  });

  it("reads the user, result and period", () => {
    expect(parseAccessLogFilters({ user: "ana", result: "failed", days: "30" })).toEqual({
      user: "ana",
      result: "failed",
      days: 30,
    });
  });

  it("falls back to the default on values the screen does not offer", () => {
    expect(parseAccessLogFilters({ result: "everything", days: "365", user: "" })).toEqual({ days: 7 });
  });
});

describe("describeAttempt", () => {
  it.each([
    ["success", "success", ""],
    ["bad_password", "failed", "Contraseña incorrecta"],
    ["unknown_user", "failed", "Usuario desconocido"],
    ["inactive", "failed", "Usuario desactivado"],
    // A refused row does not say which lock refused it (user or IP).
    ["locked", "locked", "Rechazado: acceso bloqueado"],
    ["unlocked", "unlocked", "Desbloqueo manual"],
  ] as const)("%s reads as %s", (outcome, result, detail) => {
    expect(describeAttempt(outcome)).toEqual({ result, detail });
  });
});

describe("originOf", () => {
  it.each([
    ["192.168.1.23", "Red del taller · 192.168.1.23"],
    ["10.0.0.4", "Red del taller · 10.0.0.4"],
    ["172.20.1.1", "Red del taller · 172.20.1.1"],
    // The server itself: the workshop PC.
    ["127.0.0.1", "Red del taller · 127.0.0.1"],
    ["::1", "Red del taller · ::1"],
    ["181.197.4.20", "Internet · 181.197.4.20"],
    ["172.32.0.1", "Internet · 172.32.0.1"],
  ])("%s", (ip, origin) => {
    expect(originOf(ip)).toBe(origin);
  });

  it("shows a dash when no address was recorded", () => {
    expect(originOf(null)).toBe("—");
  });
});
