import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { CustomerBoard } from "@/modules/board/CustomerBoard";
import { customerBoardOrders } from "@/modules/board/queries";
import { toCustomerSnapshot } from "@/modules/board/shape";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";

/** First paint from the server; the client poller keeps it live. Props are plain data (ISO strings). */
export default async function CustomerBoardPage() {
  const user = await requireSessionFromHeaders();
  if (!can(user, "board.customer")) {
    return <PermissionDenied title="Tablero de clientes" />;
  }
  const now = new Date();
  return <CustomerBoard initial={toCustomerSnapshot(await customerBoardOrders(now), now)} />;
}
