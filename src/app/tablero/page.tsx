import { can } from "@/modules/auth/policy";
import { requireSessionFromHeaders } from "@/modules/auth/session";
import { workshopBoardData } from "@/modules/board/queries";
import { toBoardSnapshot } from "@/modules/board/shape";
import { WorkshopBoard } from "@/modules/board/WorkshopBoard";
import { PermissionDenied } from "@/shared/ui/PermissionDenied";

/** First paint from the server; the client poller keeps it live. Props are plain data (ISO strings). */
export default async function BoardPage() {
  const user = await requireSessionFromHeaders();
  if (!can(user, "board.read")) {
    return <PermissionDenied title="Tablero del taller" />;
  }
  const now = new Date();
  const { rows, techs, since } = await workshopBoardData(now);
  return <WorkshopBoard initial={toBoardSnapshot(rows, techs, since, now)} />;
}
