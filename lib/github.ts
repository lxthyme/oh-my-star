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

export interface GitHubGistFile {
  name: string
  language: string | null
  size: number
  /** 截断后的内容预览 */
  preview: string
}

export interface GitHubGistData {
  /** GitHub gist id，是字符串而不是数字 */
  id: string
  description: string | null
  htmlUrl: string
  ownerLogin: string
  ownerAvatar: string | null
  public: boolean
  commentsCount: number
  forksCount: number
  stargazersCount: number
  files: GitHubGistFile[]
  createdAt: string | null
  updatedAt: string | null
}

interface RawGitHubGist {
  id: string
  description?: string | null
  html_url: string
  owner?: { login: string; avatar_url?: string | null } | null
  public?: boolean
  comments?: number
  forks?: unknown[]
  files?: Record<
    string,
    {
      filename?: string
      language?: string | null
      size?: number
      content?: string
    }
  > | null
  created_at?: string
  updated_at?: string
}

/** 每个文件最多保留这么多行做预览，避免把整篇内容塞进数据库 */
const GIST_PREVIEW_LINES = 12
/** 只有前几个文件带预览，剩下的只留文件名等元信息 */
const GIST_PREVIEW_FILES = 3

function buildPreview(content: string | undefined): string {
  if (!content) return ""
  return content.split("\n").slice(0, GIST_PREVIEW_LINES).join("\n")
}

function mapGist(raw: RawGitHubGist): GitHubGistData {
  const entries = Object.values(raw.files ?? {})
  const files: GitHubGistFile[] = entries.map((file, index) => ({
    name: file.filename ?? "",
    language: file.language ?? null,
    size: file.size ?? 0,
    preview: index < GIST_PREVIEW_FILES ? buildPreview(file.content) : "",
  }))

  return {
    id: raw.id,
    description: raw.description ?? null,
    htmlUrl: raw.html_url,
    ownerLogin: raw.owner?.login ?? "",
    ownerAvatar: raw.owner?.avatar_url ?? null,
    public: Boolean(raw.public),
    commentsCount: raw.comments ?? 0,
    forksCount: raw.forks?.length ?? 0,
    // GitHub 的 gist 接口不返回 star 数，这里只能留 0，等官方开放字段后直接填上
    stargazersCount: 0,
    files,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  }
}

export async function listOwnedGists(
  client: Octokit,
): Promise<GitHubGistData[]> {
  const raw = (await client.paginate(client.rest.gists.list, {
    per_page: 100,
  })) as RawGitHubGist[]
  return raw.map(mapGist)
}

export async function listStarredGists(
  client: Octokit,
): Promise<GitHubGistData[]> {
  const raw = (await client.paginate(client.rest.gists.listStarred, {
    per_page: 100,
  })) as RawGitHubGist[]
  return raw.map(mapGist)
}

export async function starGist(client: Octokit, gistId: string): Promise<void> {
  await client.rest.gists.star({ gist_id: gistId })
}

export async function unstarGist(
  client: Octokit,
  gistId: string,
): Promise<void> {
  await client.rest.gists.unstar({ gist_id: gistId })
}
