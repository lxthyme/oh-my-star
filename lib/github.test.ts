import { describe, expect, it, vi } from "vitest"
import {
  listOwnedGists,
  listOwnedRepos,
  listStarredGists,
  listStarredRepos,
} from "./github"

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

const RAW_GIST = {
  id: "abc123",
  description: "a demo gist",
  html_url: "https://gist.github.com/abc123",
  owner: { login: "octocat", avatar_url: "https://avatars/octocat" },
  public: false,
  comments: 3,
  forks: [{ id: "f1" }, { id: "f2" }],
  files: {
    "hello.ts": {
      filename: "hello.ts",
      language: "TypeScript",
      size: 42,
      content: "const x = 1\nconst y = 2",
    },
  },
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

function makeGistStubClient(paginateResult: unknown) {
  return {
    paginate: vi.fn().mockResolvedValue(paginateResult),
    rest: {
      gists: { list: vi.fn(), listStarred: vi.fn() },
    },
  } as unknown as Parameters<typeof listOwnedGists>[0]
}

describe("listOwnedGists", () => {
  it("maps raw gist fields to camelCase and counts forks from the array", async () => {
    const result = await listOwnedGists(makeGistStubClient([RAW_GIST]))

    expect(result).toEqual([
      {
        id: "abc123",
        description: "a demo gist",
        htmlUrl: "https://gist.github.com/abc123",
        ownerLogin: "octocat",
        ownerAvatar: "https://avatars/octocat",
        public: false,
        commentsCount: 3,
        forksCount: 2,
        stargazersCount: 0,
        files: [
          {
            name: "hello.ts",
            language: "TypeScript",
            size: 42,
            preview: "const x = 1\nconst y = 2",
          },
        ],
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ])
  })

  it("defaults missing optional fields", async () => {
    const result = await listOwnedGists(
      makeGistStubClient([
        {
          id: "g",
          html_url: "https://gist.github.com/g",
          public: true,
          files: {},
        },
      ]),
    )
    expect(result[0]).toEqual(
      expect.objectContaining({
        description: null,
        ownerLogin: "",
        ownerAvatar: null,
        commentsCount: 0,
        forksCount: 0,
        files: [],
      }),
    )
  })
})

describe("listStarredGists", () => {
  it("returns the same mapped gist shape for starred gists", async () => {
    const result = await listStarredGists(makeGistStubClient([RAW_GIST]))
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("abc123")
  })
})
