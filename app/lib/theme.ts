export type ThemeMode = "light" | "dark" | "system"

export const THEME_STORAGE_KEY = "theme"

export function resolveTheme(
  mode: ThemeMode,
  prefersDark: boolean,
): "light" | "dark" {
  if (mode === "system") return prefersDark ? "dark" : "light"
  return mode
}

// 在 <head> 内同步执行，必须在 React 接管前把 data-theme 写到 <html> 上，避免首屏闪烁。
// 逻辑需与 resolveTheme 保持一致，但不能 import（脚本运行时 React/模块系统还未加载）。
export const THEME_INLINE_SCRIPT = `(function(){try{var stored=localStorage.getItem("${THEME_STORAGE_KEY}");var dark=stored==="dark"||(stored!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",dark?"dark":"light")}catch(e){}})()`
