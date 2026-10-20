import { Suspense } from "react"
import GistList from "../components/GistList"

export default function GistsPage() {
  return (
    <Suspense>
      <GistList source="owned" />
    </Suspense>
  )
}
