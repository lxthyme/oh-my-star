import { defineConfig } from "drizzle-kit"
import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
})
