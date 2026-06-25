import { describe, expect, it, vi } from "vitest"
import { listOwnedRepos, listStarredRepos } from "./github"

const RAW_REPO = {
  id: 1,
  full_name: "octocat/Hello-World",
  name: "Hello-World",
  owner: { login: "octocat", avatar_url: "https://avatars/octocat" },
  description: "My first repo",
  html_url: "https://github.com/octocat/Hello-World",
  language: "TypeScript",
  topics: ["demo"],
  stargazers_count: 10,
  forks_count: 2,
  archived: false,
  fork: false,
  private: false,
  is_template: false,
  pushed_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  created_at: "2025-01-01T00:00:00Z",
}

function makeStubClient(paginateResult: unknown) {
  return {
    paginate: vi.fn().mockResolvedValue(paginateResult),
    rest: {
      repos: { listForAuthenticatedUser: vi.fn() },
      activity: { listReposStarredByAuthenticatedUser: vi.fn() },
    },
  } as unknown as Parameters<typeof listOwnedRepos>[0]
}

describe("listOwnedRepos", () => {
  it("maps raw GitHub repo fields to camelCase GitHubRepoData", async () => {
    const client = makeStubClient([RAW_REPO])
    const result = await listOwnedRepos(client)

    expect(result).toEqual([
      {
        id: 1,
        fullName: "octocat/Hello-World",
        name: "Hello-World",
        ownerLogin: "octocat",
        ownerAvatar: "https://avatars/octocat",
        description: "My first repo",
        htmlUrl: "https://github.com/octocat/Hello-World",
        language: "TypeScript",
        topics: ["demo"],
        stargazersCount: 10,
        forksCount: 2,
        archived: false,
        fork: false,
        private: false,
        isTemplate: false,
        mirrorUrl: null,
        pushedAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        createdAt: "2025-01-01T00:00:00Z",
      },
    ])
  })

  it("defaults missing optional fields to null/empty", async () => {
    const client = makeStubClient([
      { ...RAW_REPO, description: null, topics: undefined, language: null },
    ])
    const result = await listOwnedRepos(client)
    expect(result[0].description).toBeNull()
    expect(result[0].topics).toEqual([])
    expect(result[0].language).toBeNull()
  })

  it("maps mirror_url to mirrorUrl, defaulting to null when absent", async () => {
    const withMirror = await listOwnedRepos(
      makeStubClient([
        {
          ...RAW_REPO,
          mirror_url: "https://git.example.com/octocat/Hello-World.git",
        },
      ]),
    )
    expect(withMirror[0].mirrorUrl).toBe(
      "https://git.example.com/octocat/Hello-World.git",
    )

    const withoutMirror = await listOwnedRepos(makeStubClient([RAW_REPO]))
    expect(withoutMirror[0].mirrorUrl).toBeNull()
  })
})

describe("listStarredRepos", () => {
  it("maps the {starred_at, repo} wrapper used by the star+json media type", async () => {
    const client = makeStubClient([
      { starred_at: "2026-03-01T00:00:00Z", repo: RAW_REPO },
    ])
    const result = await listStarredRepos(client)

    expect(result).toEqual([
      {
        repo: expect.objectContaining({
          id: 1,
          fullName: "octocat/Hello-World",
        }),
        starredAt: "2026-03-01T00:00:00Z",
      },
    ])
  })
})
