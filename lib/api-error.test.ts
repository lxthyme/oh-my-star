import { describe, expect, it } from "vitest"
import { apiErrorResponse } from "./api-error"

describe("apiErrorResponse", () => {
  it("returns the real error message as JSON", async () => {
    const response = apiErrorResponse(
      new Error("Server returned HTTP status 401"),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Server returned HTTP status 401",
    })
  })

  it("uses a safe fallback for non-error values", async () => {
    const response = apiErrorResponse(undefined)

    await expect(response.json()).resolves.toEqual({ error: "服务器内部错误" })
  })
})
