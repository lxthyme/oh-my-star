import { describe, expect, it } from "vitest"
import { resolveTheme } from "./theme"

describe("resolveTheme", () => {
  it("returns light when mode is light, regardless of system preference", () => {
    expect(resolveTheme("light", true)).toBe("light")
    expect(resolveTheme("light", false)).toBe("light")
  })

  it("returns dark when mode is dark, regardless of system preference", () => {
    expect(resolveTheme("dark", true)).toBe("dark")
    expect(resolveTheme("dark", false)).toBe("dark")
  })

  it("follows system preference when mode is system", () => {
    expect(resolveTheme("system", true)).toBe("dark")
    expect(resolveTheme("system", false)).toBe("light")
  })
})
