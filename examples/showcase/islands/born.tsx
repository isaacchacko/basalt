import { useEffect, useRef, useState } from "preact/hooks"
import { createPortal } from "preact/compat"

// "Basalt is young": pointing at it shows the month Basalt was born in the
// side content, level with its line, with the day marked and how long ago it
// was, counted in the reader's own browser (so the published page is never
// out of date). With no side content (a phone), a tap shows it under the line.

const BORN = new Date(2026, 9, 24) // Saturday, October 24, 2026
const DAY = 86_400_000
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const age = (today: Date) => Math.round((startOf(today).getTime() - BORN.getTime()) / DAY)

function Calendar({ today }: { today: Date }) {
  const year = BORN.getFullYear()
  const month = BORN.getMonth()
  const first = new Date(year, month, 1).getDay()
  const length = new Date(year, month + 1, 0).getDate()
  const cells = [...Array(first).fill(null), ...Array.from({ length }, (_, i) => i + 1)]
  const isToday = (d: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === d
  const days = age(today)
  return (
    <div class="born-card" role="tooltip">
      <p class="born-month">October 2026</p>
      <div class="born-grid">
        {WEEKDAYS.map((w, i) => (
          <span key={`w${i}`} class="born-weekday">
            {w}
          </span>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            <span key={`e${i}`} />
          ) : (
            <span
              key={d}
              class={`born-day${d === BORN.getDate() ? " is-born" : ""}${isToday(d) ? " is-today" : ""}`}
            >
              {d}
            </span>
          ),
        )}
      </div>
      <p class="born-line">
        Born on Saturday, October 24, 2026.{" "}
        {days <= 0 ? "That's today." : `${days} ${days === 1 ? "day" : "days"} old.`}
      </p>
    </div>
  )
}

const STYLE = `
.born { cursor: help; }
.born-label { text-decoration: underline dotted color-mix(in srgb, var(--tertiary) 70%, transparent); text-underline-offset: 3px; }
.born-float { position: absolute; z-index: 5; animation: born-in 180ms cubic-bezier(0.2, 0.7, 0.1, 1); }
.born-under { display: block; margin: 0.4rem 0 0.2rem; animation: born-in 180ms cubic-bezier(0.2, 0.7, 0.1, 1); }
@keyframes born-in { from { opacity: 0; transform: translateY(4px); } }
.born-card { box-sizing: border-box; max-width: 15rem; padding: 0.7rem 0.8rem 0.75rem; border: 1px solid var(--lightgray); border-radius: 8px; background: var(--light); color: var(--darkgray); font-family: var(--bodyFont); font-size: 0.85rem; line-height: 1.4; }
.born-month { margin: 0 0 0.45rem; font-family: var(--titleFont); font-style: italic; font-size: 0.95rem; color: var(--dark); }
.born-grid { display: grid; grid-template-columns: repeat(7, 1.8rem); gap: 2px; text-align: center; font-variant-numeric: tabular-nums; }
.born-weekday { font-family: var(--titleFont); font-style: italic; font-size: 0.75rem; color: var(--gray); }
.born-day { line-height: 1.8rem; border-radius: 50%; }
.born-day.is-born { background: var(--tertiary); color: var(--light); font-weight: 600; }
.born-day.is-today:not(.is-born) { box-shadow: inset 0 0 0 1px var(--tertiary); }
.born-line { margin: 0.55rem 0 0; }
`

export default function Born({ label = "Basalt is young." }: { label?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [at, setAt] = useState<{ left: number; top: number; width: number } | null>(null)
  const [under, setUnder] = useState(false)
  const [today, setToday] = useState(() => new Date())
  const leave = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (document.getElementById("born-style")) return
    const style = document.createElement("style")
    style.id = "born-style"
    style.textContent = STYLE
    document.head.append(style)
  }, [])

  // the side content beside the main content, if this page has room for it
  const side = () => {
    const margin = document.querySelector<HTMLElement>("aside.margin")
    if (!margin || document.documentElement.dataset.margin !== "beside") return null
    const r = margin.getBoundingClientRect()
    return r.width >= 140 ? r : null
  }

  const show = () => {
    window.clearTimeout(leave.current)
    const r = side()
    const line = ref.current?.getClientRects()[0]
    if (!r || !line) return
    setToday(new Date())
    setAt({ left: r.left + scrollX + 16, top: line.top + scrollY - 10, width: r.width - 32 })
  }
  const hide = () => {
    leave.current = window.setTimeout(() => setAt(null), 250)
  }

  return (
    <span
      ref={ref}
      class="born"
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={() => {
        if (side()) return
        setToday(new Date())
        setUnder(!under)
      }}
    >
      <span class="born-label">{label}</span>
      {under && (
        <span class="born-under">
          <Calendar today={today} />
        </span>
      )}
      {at &&
        createPortal(
          <div
            class="born-float"
            style={{ left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px` }}
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            <Calendar today={today} />
          </div>,
          document.body,
        )}
    </span>
  )
}
