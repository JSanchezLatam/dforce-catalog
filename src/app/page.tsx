import { redirect } from "next/navigation";

import { landingPathFor } from "@/modules/auth/landing";
import { requireSessionFromHeaders } from "@/modules/auth/session";

// Reaching this page means proxy.ts already confirmed a valid session
// (unauthenticated requests are redirected to /login before this renders); the
// role decides which landing view the session belongs on.
export default async function Home() {
  const user = await requireSessionFromHeaders();
  redirect(landingPathFor(user.role));
}
