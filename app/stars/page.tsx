import { Suspense } from "react"
import RepoList from "../components/RepoList"

export default function StarsPage() {
  return (
    <Suspense>
      <RepoList source="starred" />
    </Suspense>
  )
}
