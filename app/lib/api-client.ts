export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  const status = [response.status, response.statusText]
    .filter(Boolean)
    .join(" ")

  if (!text) {
    throw new Error(`请求失败（${status}）`)
  }

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    if (!response.ok) {
      throw new Error(text)
    }
    throw new Error(`服务器返回了无效的 JSON 响应（${status}）`)
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `请求失败（${status}）`
    throw new Error(message)
  }

  return body as T
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  return parseJsonResponse<T>(await fetch(input, init))
}
