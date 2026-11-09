import { handleLogin } from "../../../../src/support/login";

// node:crypto and pg: not the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public by design: this is how a session starts. Every other support route calls requireSupport().
export const POST = (request: Request) => handleLogin(request);
