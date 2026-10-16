import { Suspense } from "react"
import TagManager from "../components/TagManager"

export default function TagsPage() {
  return (
    <Suspense>
      <TagManager />
    </Suspense>
  )
}
