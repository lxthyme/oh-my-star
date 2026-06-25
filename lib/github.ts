import { Octokit } from "@octokit/rest"

export function createGitHubClient(token: string): Octokit {
  return new Octokit({ auth: token })
}

export interface GitHubRepoData {
  id: number
  fullName: string
  name: string
  ownerLogin: string
  ownerAvatar: string | null
  description: string | null
  htmlUrl: string
  language: string | null
  topics: string[]
  stargazersCount: number
  forksCount: number
  archived: boolean
  fork: boolean
  private: boolean
  isTemplate: boolean
  mirrorUrl: string | null
  pushedAt: string | null
  updatedAt: string | null
  createdAt: string | null
}

interface RawGitHubRepo {
  id: number
  full_name: string
  name: string
  owner: { login: string; avatar_url?: string | null }
  description?: string | null
  html_url: string
  language?: string | null
  topics?: string[]
  stargazers_count?: number
  forks_count?: number
  archived?: boolean
  fork?: boolean
  private?: boolean
  is_template?: boolean
  mirror_url?: string | null
  pushed_at?: string | null
  updated_at?: string | null
  created_at?: string | null
}

function mapRepo(raw: RawGitHubRepo): GitHubRepoData {
  return {
    id: raw.id,
    fullName: raw.full_name,
    name: raw.name,
    ownerLogin: raw.owner.login,
    ownerAvatar: raw.owner.avatar_url ?? null,
    description: raw.description ?? null,
    htmlUrl: raw.html_url,
    language: raw.language ?? null,
    topics: raw.topics ?? [],
    stargazersCount: raw.stargazers_count ?? 0,
    forksCount: raw.forks_count ?? 0,
    archived: Boolean(raw.archived),
    fork: Boolean(raw.fork),
    private: Boolean(raw.private),
    isTemplate: Boolean(raw.is_template),
    mirrorUrl: raw.mirror_url ?? null,
    pushedAt: raw.pushed_at ?? null,
    updatedAt: raw.updated_at ?? null,
    createdAt: raw.created_at ?? null,
  }
}

export async function listOwnedRepos(
  client: Octokit,
): Promise<GitHubRepoData[]> {
  const raw = (await client.paginate(
    client.rest.repos.listForAuthenticatedUser,
    {
      per_page: 100,
      affiliation: "owner",
    },
  )) as RawGitHubRepo[]
  return raw.map(mapRepo)
}

export interface StarredRepoData {
  repo: GitHubRepoData
  starredAt: string
}

export async function listStarredRepos(
  client: Octokit,
): Promise<StarredRepoData[]> {
  const raw = (await client.paginate(
    client.rest.activity.listReposStarredByAuthenticatedUser,
    {
      per_page: 100,
      headers: { accept: "application/vnd.github.star+json" },
    },
  )) as unknown as Array<{ starred_at: string; repo: RawGitHubRepo }>
  return raw.map((entry) => ({
    repo: mapRepo(entry.repo),
    starredAt: entry.starred_at,
  }))
}

export async function starRepo(
  client: Octokit,
  owner: string,
  repo: string,
): Promise<void> {
  await client.rest.activity.starRepoForAuthenticatedUser({ owner, repo })
}

export async function unstarRepo(
  client: Octokit,
  owner: string,
  repo: string,
): Promise<void> {
  await client.rest.activity.unstarRepoForAuthenticatedUser({ owner, repo })
}
