// The theme toggle. Head.astro sets the theme before the first paint; this
// switches it, keeps it across page transitions (the incoming page's <html>
// has none of its own), and follows the system while the reader hasn't chosen.

const root = document.documentElement
const current = () => (root.getAttribute("saved-theme") === "dark" ? "dark" : "light")

function setTheme(theme: "light" | "dark", remember: boolean) {
  root.setAttribute("saved-theme", theme)
  if (remember) {
    try {
      localStorage.setItem("theme", theme)
    } catch {}
  }
  document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }))
}

document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest?.(".darkmode")) return
  setTheme(current() === "dark" ? "light" : "dark", true)
})

document.addEventListener("astro:before-swap", (e) => {
  e.newDocument.documentElement.setAttribute("saved-theme", current())
})

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  let chosen: string | null = null
  try {
    chosen = localStorage.getItem("theme")
  } catch {}
  if (!chosen) setTheme(e.matches ? "dark" : "light", false)
})
