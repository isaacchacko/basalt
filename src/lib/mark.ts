// Basalt's mark: a B (TeX Gyre Pagella Bold, Palatino's free twin) set in
// solid, line-drawn. Its front face is paper with the accent's outline; its
// depth, up and to the right, is a stack of copies of it, each covering the
// one behind but for its edge, so nothing shows through.

export const B = "M5.5 6.75 6.75 6.85C8.27 6.99 8.37 7.19 8.37 10.16V25.29C8.37 26.44 8.2 26.95 7.7 27.22L6.61 27.82V28.6C8.03 28.53 9.45 28.5 10.87 28.5C12.46 28.5 14.08 28.53 15.67 28.6C20.06 28.6 24.82 25.56 24.82 21.2C24.82 19.41 24.14 17.93 22.96 17.08C21.74 16.24 20.6 15.94 17.89 15.77C20.73 14.75 21.71 14.28 22.76 13.3C23.57 12.56 24.04 11.34 24.04 10.06C24.04 6.99 21.91 5.5 17.66 5.5C15.5 5.5 13.34 5.6 11.17 5.6C9.28 5.6 7.39 5.57 5.5 5.5ZM13.13 26.61V16.75H14.15C18.06 16.75 19.75 18.23 19.75 21.68C19.75 25.19 18.16 26.74 14.58 26.74C14.08 26.74 13.71 26.71 13.13 26.61ZM13.13 14.99V7.32C13.94 7.22 14.45 7.19 15.09 7.19C17.83 7.19 19.04 8.3 19.04 10.8C19.04 13.74 17.56 14.99 14.15 14.99Z"

/** the depth's copies, back to front */
export const depth = Array.from({ length: 28 }, (_, i) => 28 - i).map(
  (i) => `translate(${((2.6 * i) / 28).toFixed(3)} ${((-2.1 * i) / 28).toFixed(3)})`,
)

/** the mark as a standalone svg in fixed colours, light and dark (the tab's icon, the banner) */
export function markSvg(light = { paper: "#ffffff", ink: "#1b3fd0" }, dark = { paper: "#0a1440", ink: "#8ea4ff" }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<style>use{fill:${light.paper};stroke:${light.ink};stroke-width:1.275;stroke-linejoin:round;paint-order:stroke}` +
    `@media (prefers-color-scheme:dark){use{fill:${dark.paper};stroke:${dark.ink}}}</style>` +
    `<defs><path id="b" d="${B}"/></defs>` +
    depth.map((t) => `<use href="#b" transform="${t}"/>`).join("") +
    `<use href="#b"/></svg>`
  )
}
