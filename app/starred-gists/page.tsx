import { Suspense } from "react"
import GistList from "../components/GistList"

export default function StarredGistsPage() {
  return (
    <Suspense>
      <GistList source="starred" />
    </Suspense>
  )
}
