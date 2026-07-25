import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const FILTER_WIDTHS = ["w-32", "w-48", "w-44", "w-44", "w-36"];
const TABLE_ROWS = 8;

/**
 * Mirrors InventoryPage's layout (stats header + filter bar + table) so the
 * skeleton doesn't cause layout shift once the real content streams in.
 */
export default function InventoryLoading() {
  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-52" />
          </div>
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
        <Card size="sm">
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-4 w-44" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Skeleton className="mb-6 h-9 w-32" />

      <Card size="sm" className="mb-4">
        <CardContent>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {FILTER_WIDTHS.map((width, index) => (
              <div key={index} className="flex flex-col gap-1">
                <Skeleton className="h-4 w-12" />
                <Skeleton className={`h-9 ${width}`} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Skeleton className="h-4 w-10" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-4 w-32" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-4 w-24" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-4 w-24" />
                </TableHead>
                <TableHead className="w-24">
                  <Skeleton className="h-4 w-14" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: TABLE_ROWS }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-7 w-14 rounded-lg" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
