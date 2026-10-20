import { Typography } from "antd"

const { Text } = Typography

/** 把命中的关键字高亮出来；keyword 为空时原样输出 */
export default function Highlight({
  text,
  keyword,
}: {
  text: string
  keyword?: string
}) {
  if (!keyword) return <>{text}</>
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const parts = text.split(new RegExp(`(${escaped})`, "gi"))
  const lower = keyword.toLowerCase()
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lower ? (
          <Text key={i} mark style={{ padding: 0 }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  )
}
