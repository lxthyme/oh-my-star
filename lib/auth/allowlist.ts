export function isAllowedGitHubLogin(
  login: string | null | undefined,
  allowlist: string | undefined,
): boolean {
  if (!login) return false
  const allowed = (allowlist ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  return allowed.includes(login)
}
