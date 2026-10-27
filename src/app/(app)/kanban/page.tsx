import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { KanbanBoard } from "@/modules/kanban/KanbanBoard";
import { kanbanData } from "@/modules/kanban/queries";
import { toKanbanSnapshot } from "@/modules/kanban/shape";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";

/**
 * First paint from the server; the client poller keeps it live. `canMove` is the only decision the
 * client gets, and the props are plain data (ISO strings, booleans), because a function or a Date
 * cannot cross the Server Component boundary.
 */
export default async function KanbanPage() {
  const user = await requireSessionFromHeaders();
  if (!can(user, "board.read")) {
    return <PermissionDenied title="Kanban" />;
  }
  const now = new Date();
  const { viewer, ...board } = await kanbanData(user.id, now);
  return <KanbanBoard initial={toKanbanSnapshot(board, viewer, now)} canMove={can(user, "service-orders.assign")} />;
}
