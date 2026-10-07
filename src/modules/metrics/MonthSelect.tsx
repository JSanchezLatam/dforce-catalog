import { Button } from "@/components/ui/button";
import { monthLabel } from "./months";

/**
 * A plain GET form, no client JS: choosing a month does nothing until "Ver" is
 * pressed, because an auto-submitting select needs an `onChange`. Both controls
 * carry the 44px floor outright rather than leaning on `pointer-coarse:`.
 * `keys` come from the server and are validated again by `parseMes` on arrival.
 */
export function MonthSelect({ keys, selected }: { keys: string[]; selected: string }) {
  return (
    <form method="get" className="flex items-center gap-2">
      <label htmlFor="mes" className="sr-only">
        Mes
      </label>
      <select
        id="mes"
        name="mes"
        defaultValue={selected}
        className="min-h-11 min-w-11 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {keys.map((key) => (
          <option key={key} value={key}>
            {monthLabel(key)}
          </option>
        ))}
      </select>
      <Button type="submit" className="min-h-11 min-w-11">
        Ver
      </Button>
    </form>
  );
}
