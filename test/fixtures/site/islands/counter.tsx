import { useState } from "preact/hooks"

// a preact island: its default export is the component, its attributes its props
export default function Counter({ start = 0 }: { start?: number }) {
  const [n, setN] = useState(start)
  return (
    <button type="button" class="counter" onClick={() => setN(n + 1)}>
      clicked {n} {n === 1 ? "time" : "times"}
    </button>
  )
}
