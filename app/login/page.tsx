import { signIn } from "@/auth"
import LoginCard from "./LoginCard"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  async function login() {
    "use server"
    await signIn("github", { redirectTo: "/" })
  }

  return <LoginCard error={error} action={login} />
}
