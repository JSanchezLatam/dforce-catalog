import { redirect } from "next/navigation";

// Reaching this page means proxy.ts already confirmed a valid session
// (unauthenticated requests are redirected to /login before this renders) —
// /inventory is the default landing view for any authenticated user.
export default function Home() {
  redirect("/inventory");
}
