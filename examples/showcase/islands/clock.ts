// a plain-js island: it exports mount(el, props) and returns how to unmount
export function mount(el: HTMLElement, { tz }: { tz?: string }) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })
  const tick = () => (el.textContent = fmt.format(new Date()))
  tick()
  const timer = setInterval(tick, 1000)
  return () => clearInterval(timer)
}
