import { describe, expect, it } from "vitest"
import { isAllowedGitHubLogin } from "./allowlist"

describe("isAllowedGitHubLogin", () => {
  it("allows a login present in the comma-separated allowlist", () => {
    expect(isAllowedGitHubLogin("octocat", "octocat,other-user")).toBe(true)
  })

  it("rejects a login not present in the allowlist", () => {
    expect(isAllowedGitHubLogin("stranger", "octocat,other-user")).toBe(false)
  })

  it("trims whitespace around allowlist entries", () => {
    expect(isAllowedGitHubLogin("octocat", " octocat , other-user ")).toBe(
      true,
    )
  })

  it("rejects when login is null, undefined, or empty", () => {
    expect(isAllowedGitHubLogin(null, "octocat")).toBe(false)
    expect(isAllowedGitHubLogin(undefined, "octocat")).toBe(false)
    expect(isAllowedGitHubLogin("", "octocat")).toBe(false)
  })

  it("rejects everything when allowlist is unset", () => {
    expect(isAllowedGitHubLogin("octocat", undefined)).toBe(false)
  })
})
