"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUrlFilters } from "@/shared/ui/filters/useUrlFilters";

import {
  ACCESS_LOG_PERIODS,
  ACCESS_LOG_RESULTS,
  DEFAULT_PERIOD,
  type AccessLogFilters as Filters,
  type AccessLogPeriod,
  type AccessLogResult,
} from "./access-log";

// Base UI needs a non-empty value for "no filter".
const ALL = "all";

/** URL-driven like `CustomerFilters`: a filter that does not survive a refresh is one nobody trusts. */
export function AccessLogFilters({ selected, usernames }: { selected: Filters; usernames: string[] }) {
  const { applyFilter, clearAll } = useUrlFilters({});
  const set = (key: string) => (value: string | null) => applyFilter(key, !value || value === ALL ? "" : value);
  const filtered = selected.user || selected.result || selected.days !== DEFAULT_PERIOD;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-user">Usuario</Label>
        <Select value={selected.user ?? ALL} onValueChange={set("user")}>
          <SelectTrigger id="filter-user" className="w-52">
            <SelectValue>{(value) => (value === ALL ? "Todos los usuarios" : value)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los usuarios</SelectItem>
            {usernames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-result">Resultado</Label>
        <Select value={selected.result ?? ALL} onValueChange={set("result")}>
          <SelectTrigger id="filter-result" className="w-48">
            <SelectValue>
              {(value) => (value === ALL ? "Todos los resultados" : ACCESS_LOG_RESULTS[value as AccessLogResult])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los resultados</SelectItem>
            {(Object.keys(ACCESS_LOG_RESULTS) as AccessLogResult[]).map((result) => (
              <SelectItem key={result} value={result}>
                {ACCESS_LOG_RESULTS[result]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-days">Período</Label>
        <Select value={String(selected.days)} onValueChange={set("days")}>
          <SelectTrigger id="filter-days" className="w-48">
            <SelectValue>{(value) => ACCESS_LOG_PERIODS[Number(value) as AccessLogPeriod]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACCESS_LOG_PERIODS).map(([days, label]) => (
              <SelectItem key={days} value={days}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {filtered && (
        <Button type="button" variant="outline" size="default" onClick={clearAll}>
          <X aria-hidden="true" />
          Limpiar
        </Button>
      )}
    </div>
  );
}
