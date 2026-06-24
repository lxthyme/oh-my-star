import { Suspense } from "react"
import RepoList from "../components/RepoList"

export default function ReposPage() {
  return (
    <Suspense>
      <RepoList source="owned" />
    </Suspense>
  )
}
