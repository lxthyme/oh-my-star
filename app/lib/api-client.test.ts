import { describe, expect, it } from "vitest"
import { parseJsonResponse } from "./api-client"

describe("parseJsonResponse", () => {
  it("returns a successful JSON response", async () => {
    const response = Response.json({ items: [] })

    await expect(parseJsonResponse(response)).resolves.toEqual({ items: [] })
  })

  it("surfaces the API error message from a failed JSON response", async () => {
    const response = Response.json(
      { error: "Server returned HTTP status 401" },
      { status: 500 },
    )

    await expect(parseJsonResponse(response)).rejects.toThrow(
      "Server returned HTTP status 401",
    )
  })

  it("reports an empty failed response without parsing it as JSON", async () => {
    const response = new Response(null, {
      status: 500,
      statusText: "Internal Server Error",
    })

    await expect(parseJsonResponse(response)).rejects.toThrow(
      "请求失败（500 Internal Server Error）",
    )
  })
})
