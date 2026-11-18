import { MIN_PASSWORD_LENGTH } from "./password-policy";

/**
 * Server-side password rules. The common-password list stays out of
 * `password-policy.ts` so it never reaches the browser bundle. Only entries of
 * at least `MIN_PASSWORD_LENGTH` characters matter: shorter ones already fail.
 */
const COMMON_PASSWORDS = new Set([
  "0000000000",
  "0123456789",
  "1111111111",
  "1122334455",
  "1234512345",
  "1234567890",
  "12345678910",
  "123456789a",
  "123456789abc",
  "1234567891",
  "1q2w3e4r5t",
  "1qaz2wsx3edc",
  "9876543210",
  "a123456789",
  "abc1234567",
  "abcd123456",
  "abcdefghij",
  "admin12345",
  "admin123456",
  "administrador",
  "administrator",
  "asdfghjkl1",
  "asdfghjkl123",
  "baseball123",
  "bienvenido",
  "bienvenido1",
  "bienvenido123",
  "changeme123",
  "contrasena",
  "contrasena1",
  "contrasena123",
  "contraseña",
  "contraseña1",
  "contraseña123",
  "dforce12345",
  "dforce123456",
  "dforcecaraudio",
  "football123",
  "iloveyou123",
  "letmein123",
  "mecanico123",
  "panama12345",
  "panama123456",
  "passw0rd123",
  "password1",
  "password12",
  "password123",
  "password1234",
  "password12345",
  "princess123",
  "qwerty12345",
  "qwerty123456",
  "qwertyuiop",
  "qwertyuiop1",
  "qwertyuiop123",
  "superman123",
  "tecnico123",
  "tecnico1234",
  "teamo12345",
  "teamo123456",
  "taller12345",
  "taller123456",
  "temporal123",
  "usuario123",
  "usuario1234",
  "welcome123",
  "zxcvbnm123",
]);

/** The Spanish message for a password that breaks the policy, or `null` when it passes. */
export function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  return COMMON_PASSWORDS.has(password.toLowerCase()) ? "Es demasiado común. Elige otra." : null;
}
