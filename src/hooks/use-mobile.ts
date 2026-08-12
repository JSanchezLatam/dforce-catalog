import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * `useSyncExternalStore` rather than useState + useEffect.
 *
 * `matchMedia` IS an external store, and this is the hook React added for
 * exactly that shape: no setState inside an effect, no extra render after
 * mount, and no window of `undefined` before the first effect runs. The
 * server snapshot is `false` — there is no viewport to measure, and guessing
 * mobile would render the wrong layout and then swap it.
 */
function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  )
}
