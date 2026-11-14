import { redirect } from "next/navigation";

import { formatPanama } from "../../../src/support/format";
import { statusCounts } from "../../../src/support/queries";
import { requireSupport } from "../../../src/support/session";
import { RANGES, isStale, parseRange, usageReport, type UsageDay } from "../../../src/usage/queries";
import { SupportHeader } from "../SupportHeader";

export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("es-PA");
const WD = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const WEEKDAY = new Intl.DateTimeFormat("es-PA", { timeZone: "America/Panama", weekday: "long" });
/** `YYYY-MM-DD` (a workshop date, already in Panama) to `dd/mm`. */
const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const weekday = (day: string) => WD[new Date(`${day}T00:00:00Z`).getUTCDay()];

// Lucide paths, as in the mockup.
const Icon = ({ d, size }: { d: string[]; size: string }) => (
  <svg className="uicon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.map((p) => (
      <path key={p} d={p} />
    ))}
  </svg>
);
const SHIELD = ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"];
const WIFI_OFF = ["M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M2 2l20 20"];
const CHART = ["M3 3v16a2 2 0 0 0 2 2h16", "M18 17V9M13 17V5M8 17v-3"];

/** Stacked bars per day; an uncovered day is a full-height hatched bar, never a zero. */
function Chart({ days, today }: { days: UsageDay[]; today: string }) {
  const max = Math.max(1, ...days.filter((d) => d.covered).map((d) => d.gestion + d.tecnico));
  const step = max <= 40 ? 10 : max <= 80 ? 20 : 50;
  const top = Math.ceil(max / step) * step;
  const n = days.length;
  const bw = 10;
  const gap = n > 40 ? 2 : n > 10 ? 4 : 8;
  const width = n * (bw + gap) - gap;
  const H = 100;
  const ticks = [0, top / 2, top];
  return (
    <div className="chart">
      <div className="yax" aria-hidden="true">
        {ticks.map((v) => (
          <span key={v} style={{ top: `${(1 - v / top) * 100}%` }}>
            {v}
          </span>
        ))}
      </div>
      <div className="plot">
        <svg viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Vistas por día, ${n} días. Los números exactos están en la tabla por día.`}>
          <defs>
            <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="var(--muted)" strokeWidth="1.5" opacity=".45" />
            </pattern>
          </defs>
          {ticks.map((v) => (
            <line key={v} className="grid" x1="0" x2={width} y1={H - (v / top) * H} y2={H - (v / top) * H} />
          ))}
          {days.map((d, i) => {
            const x = i * (bw + gap);
            const label = `${weekday(d.day)} ${dm(d.day)}${d.day === today ? " (hoy)" : ""}`;
            if (!d.covered)
              return (
                <rect key={d.day} className="nd" fill="url(#hatch)" x={x} y="0" width={bw} height={H} rx="1">
                  <title>{`${label}: Sin datos todavía`}</title>
                </rect>
              );
            const ht = (d.tecnico / top) * H;
            const hg = (d.gestion / top) * H;
            const cls = d.day === today ? " today" : "";
            return (
              <g key={d.day}>
                <title>{`${label}: Gestión ${d.gestion} · Técnicos ${d.tecnico} · Total ${d.gestion + d.tecnico}`}</title>
                {d.tecnico > 0 && <rect className={`t${cls}`} x={x} y={H - ht} width={bw} height={ht} />}
                {d.gestion > 0 && <rect className={`g${cls}`} x={x} y={H - ht - hg} width={bw} height={Math.max(0, hg - 0.6)} />}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="xax" aria-hidden="true">
        <span>{dm(days[0].day)}</span>
        <span>{dm(days[Math.floor(n / 2)].day)}</span>
        <span>hoy {dm(today)}</span>
      </div>
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await requireSupport())) redirect("/support/login");
  const range = parseRange((await searchParams).r);
  const [r, { nuevo }] = await Promise.all([usageReport(range), statusCounts()]);
  const header = <SupportHeader nuevo={nuevo} />;

  const head = (
    <div className="uhd">
      <div>
        <h1 className="title">Uso de la app</h1>
        <p className="anon muted small">
          <Icon d={SHIELD} size="14" />
          <span>Conteos anónimos: por pantalla y grupo, nunca por persona.</span>
        </p>
      </div>
      {r.newest && (
        <div className="psel">
          <span id="rng-l">Período</span>
          <div className="pseg" role="group" aria-labelledby="rng-l">
            {RANGES.map((n) => (
              <a key={n} href={`/support/uso?r=${n}`} aria-current={n === range ? "true" : undefined}>
                {n} días
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  if (!r.newest)
    return (
      <>
      {header}
      <main className="page wide usage">
        {head}
        <div className="card pempty">
          <Icon d={CHART} size="40" />
          <h2 className="title">Todavía no llegaron datos de uso</h2>
          <p className="muted">Los envía el taller una vez por hora cuando tiene internet. Si pasó más de un día, revisá que el taller esté actualizado y conectado.</p>
        </div>
      </main>
      </>
    );

  const label = new Map(r.catalog.map((s) => [s.pattern, s.label]));
  const rows = r.screens
    .map((s) => ({ ...s, n: s.gestion + s.tecnico, label: label.get(s.screen) ?? s.screen }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "es"));
  const used = new Set(rows.map((s) => s.screen));
  const zero = r.catalog.filter((s) => !used.has(s.pattern)).sort((a, b) => a.label.localeCompare(b.label, "es"));
  const G = rows.reduce((a, s) => a + s.gestion, 0);
  const T = rows.reduce((a, s) => a + s.tecnico, 0);
  const maxN = rows[0]?.n ?? 1;
  const covered = r.days.filter((d) => d.covered).length;
  const missing = covered < r.days.length;
  const z = (v: number) => (v ? undefined : "z");
  const ago = r.newestAgeDays ?? 0;

  return (
    <>
    {header}
    <main className="page wide usage">
      {head}
      {isStale(r.newest, new Date()) && (
        <div className="notice stale" role="status">
          <Icon d={WIFI_OFF} size="18" />
          <p>
            <b>
              El último dato llegó hace {ago} {ago === 1 ? "día" : "días"}
            </b>{" "}
            ({WEEKDAY.format(r.newest)} {formatPanama(r.newest).slice(0, 5)}, {formatPanama(r.newest).slice(11)}). El taller estuvo sin internet o apagado. Los días que faltan se ven rayados y no cuentan como cero; se completan solos con el próximo envío.
          </p>
        </div>
      )}
      <p className="sum">
        <span className="big">{fmt(G + T)} vistas</span>
        <span className="key">
          <i className="sw g" />
          Gestión <b>{fmt(G)}</b>
        </span>
        <span className="key">
          <i className="sw t" />
          Técnicos <b>{fmt(T)}</b>
        </span>
        {/* The spec requires the covered-day count always; the mockup showed it only when days were missing. */}
        <span>
          {r.catalog.length - zero.length} de {r.catalog.length} pantallas con visitas · {covered} de {r.days.length} días con datos
        </span>
      </p>
      <div className="ugrid">
        <div className="ucol">
          <section className="card" aria-labelledby="tr-h">
            <div className="card-hd">
              <h2 id="tr-h">Vistas por día</h2>
              <div className="legend">
                <span className="key">
                  <i className="sw g" />
                  Gestión
                </span>
                <span className="key">
                  <i className="sw t" />
                  Técnicos
                </span>
                {missing && (
                  <span className="key">
                    <i className="sw nd" />
                    Sin datos todavía
                  </span>
                )}
              </div>
            </div>
            <Chart days={r.days} today={r.today} />
            <details className="days">
              <summary>Ver los números por día</summary>
              <div className="dtable">
                <table className="ut">
                  <thead>
                    <tr>
                      <th scope="col">Día</th>
                      <th scope="col">Gestión</th>
                      <th scope="col">Técnicos</th>
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...r.days].reverse().map((d) => (
                      <tr key={d.day}>
                        <td>
                          {weekday(d.day)} {dm(d.day)}
                          {d.day === r.today && " (hoy, en curso)"}
                        </td>
                        {d.covered ? (
                          <>
                            <td className={z(d.gestion)}>{fmt(d.gestion)}</td>
                            <td className={z(d.tecnico)}>{fmt(d.tecnico)}</td>
                            <td className="tot">{fmt(d.gestion + d.tecnico)}</td>
                          </>
                        ) : (
                          <td className="z" colSpan={3}>
                            Sin datos todavía
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <section className="card" aria-labelledby="tb-h">
            <div className="card-hd">
              <h2 id="tb-h">Por pantalla</h2>
              <span className="small muted">De más a menos vistas</span>
            </div>
            <table className="ut">
              <thead>
                <tr>
                  <th scope="col">Pantalla</th>
                  <th scope="col">Gestión</th>
                  <th scope="col">Técnicos</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.screen}>
                    <td>
                      <span className="scr">{s.label}</span>
                      <span className="route">{s.screen}</span>
                      <span className="bar" style={{ width: `${Math.max(4, (s.n / maxN) * 100)}%` }} aria-hidden="true">
                        <i className="g" style={{ width: `${(s.gestion / s.n) * 100}%` }} />
                        <i className="t" style={{ width: `${(s.tecnico / s.n) * 100}%` }} />
                      </span>
                    </td>
                    <td className={z(s.gestion)}>{fmt(s.gestion)}</td>
                    <td className={z(s.tecnico)}>{fmt(s.tecnico)}</td>
                    <td className="tot">{fmt(s.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <div className="ucol">
          <section className="card" aria-labelledby="zl-h">
            <div className="card-hd">
              <h2 id="zl-h">Sin visitas en el período</h2>
              <span className="small muted">{zero.length}</span>
            </div>
            {zero.length ? (
              <ul className="zl">
                {zero.map((s) => (
                  <li key={s.pattern}>
                    <span>{s.label}</span>
                    <span className="route">{s.pattern}</span>
                    <span className="seen">{r.lastSeen[s.pattern] ? `Última visita: ${dm(r.lastSeen[s.pattern])}` : "Nunca en los últimos 90 días"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="allused">Todas las pantallas tuvieron al menos una visita.</p>
            )}
          </section>
          <section className="card" aria-labelledby="gr-h">
            <div className="card-hd">
              <h2 id="gr-h">Grupos</h2>
            </div>
            <dl className="groups">
              <div>
                <dt>
                  <i className="sw g" />
                  Gestión
                </dt>
                <dd>Administrador y jefe de taller, juntos.</dd>
              </div>
              <div>
                <dt>
                  <i className="sw t" />
                  Técnicos
                </dt>
                <dd>Todos los técnicos, juntos.</dd>
              </div>
            </dl>
            <p className="small muted">Cuenta cada vez que alguien abre una pantalla. Sin usuario, sin hora, sin datos de la orden o del cliente.</p>
          </section>
        </div>
      </div>
    </main>
    </>
  );
}
