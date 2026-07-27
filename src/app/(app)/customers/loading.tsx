import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TABLE_ROWS = 8;

/** Mirrors CustomersPage's layout (heading + filter bar + table) — no layout shift once real content streams in. */
export default function CustomersLoading() {
  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>

      <Card size="sm" className="mb-4">
        <CardContent>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-col gap-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-9 w-64" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Skeleton className="h-4 w-24" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-4 w-24" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-4 w-32" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-4 w-16" />
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
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-36" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
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
