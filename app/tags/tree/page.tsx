import { Suspense } from "react"
import TagTreePage from "../../components/TagTreePage"

export default function TagTreeRoute() {
  return (
    <Suspense>
      <TagTreePage />
    </Suspense>
  )
}
