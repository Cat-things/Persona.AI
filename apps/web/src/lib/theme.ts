export type Theme = "dark" | "light" | "system";

export function resolvedTheme(t: Theme): "dark" | "light" {
  if (t === "system") return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  return t;
}

export function applyTheme(t: Theme) {
  try {
    localStorage.setItem("persona-theme", t);
  } catch {
    /* private mode */
  }
  const r = resolvedTheme(t);
  document.documentElement.dataset.theme = r;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", r === "dark" ? "#1b1a2b" : "#f9f9fc");
}

export function currentTheme(): Theme {
  try {
    return (localStorage.getItem("persona-theme") as Theme) || "dark";
  } catch {
    return "dark";
  }
}
