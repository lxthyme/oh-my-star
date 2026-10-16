"use client"

import { useEffect, useMemo, useRef } from "react"
import * as echarts from "echarts/core"
import { TreeChart } from "echarts/charts"
import { TooltipComponent } from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"
import { theme } from "antd"

echarts.use([TreeChart, TooltipComponent, CanvasRenderer])

export interface TagTreeNode {
  id: number
  name: string
  description: string | null
  repoCount: number
  parentId: number | null
  depth: number
  path: string
  childrenCount: number
  totalRepoCount: number
}

interface TagTreeChartProps {
  tags: TagTreeNode[]
  /** 当前选中的标签，用于高亮 */
  selectedId: number | null
  /** -1 全部展开；1 只展开一层；2 展开两层 */
  initialTreeDepth: number
  orient: "LR" | "TB"
  onSelect: (id: number | null) => void
}

interface TreeNode {
  name: string
  value: number
  tagId: number | null
  repoCount: number
  totalRepoCount: number
  description: string | null
  path: string
  childrenCount: number
  depth: number
  itemStyle?: Record<string, unknown>
  children: TreeNode[]
}

const VIRTUAL_ROOT_NAME = "全部标签"

function buildTree(
  tags: TagTreeNode[],
  selectedId: number | null,
  highlightColor: string,
): TreeNode {
  const nodes = new Map<number, TreeNode>()
  for (const tag of tags) {
    nodes.set(tag.id, {
      name: tag.name,
      value: tag.totalRepoCount,
      tagId: tag.id,
      repoCount: tag.repoCount,
      totalRepoCount: tag.totalRepoCount,
      description: tag.description,
      path: tag.path,
      childrenCount: tag.childrenCount,
      depth: tag.depth,
      children: [],
    })
  }

  const roots: TreeNode[] = []
  for (const tag of tags) {
    const node = nodes.get(tag.id)!
    const parent =
      tag.parentId !== null ? (nodes.get(tag.parentId) ?? null) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  for (const node of nodes.values()) {
    if (node.childrenCount > 0) node.childrenCount = node.children.length
    if (node.tagId === selectedId) {
      node.itemStyle = {
        borderColor: highlightColor,
        borderWidth: 3,
        shadowBlur: 8,
        shadowColor: highlightColor,
      }
    }
  }

  const total = roots.reduce((sum, node) => sum + node.totalRepoCount, 0)
  return {
    name: VIRTUAL_ROOT_NAME,
    value: total,
    tagId: null,
    repoCount: total,
    totalRepoCount: total,
    description: null,
    path: VIRTUAL_ROOT_NAME,
    childrenCount: roots.length,
    depth: 0,
    children: roots,
  }
}

function symbolSizeFor(value: number, max: number): number {
  if (max <= 0) return 18
  const ratio = Math.sqrt(Math.max(value, 0) / max)
  return 18 + ratio * 34
}

export default function TagTreeChart({
  tags,
  selectedId,
  initialTreeDepth,
  orient,
  onSelect,
}: TagTreeChartProps) {
  const { token } = theme.useToken()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  const treeData = useMemo(
    () => buildTree(tags, selectedId, token.colorWarning),
    [tags, selectedId, token.colorWarning],
  )
  const maxValue = useMemo(
    () => tags.reduce((max, tag) => Math.max(max, tag.totalRepoCount), 0),
    [tags],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = echarts.init(container, undefined, { renderer: "canvas" })
    chartRef.current = chart
    chart.on("click", (params) => {
      const data = params.data as TreeNode | undefined
      if (data?.tagId != null) onSelectRef.current(data.tagId)
    })

    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(container)

    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    chart.setOption(
      {
        backgroundColor: "transparent",
        tooltip: {
          trigger: "item",
          confine: true,
          backgroundColor: token.colorBgElevated,
          borderColor: token.colorBorderSecondary,
          textStyle: { color: token.colorText, fontSize: 12 },
          formatter: (params: unknown) => {
            const item = params as {
              data?: TreeNode
              name?: string
              value?: number
            }
            const data = item.data
            if (!data) return ""
            const rows = [
              `<div style="font-weight:600">${data.path}</div>`,
              `<div>仓库：${data.totalRepoCount}（自身 ${data.repoCount}）</div>`,
            ]
            if (data.childrenCount > 0) {
              rows.push(`<div>子标签：${data.childrenCount}</div>`)
            }
            if (data.description) {
              const desc =
                data.description.length > 120
                  ? `${data.description.slice(0, 120)}…`
                  : data.description
              rows.push(`<div style="opacity:.7;margin-top:4px">${desc}</div>`)
            }
            return rows.join("")
          },
        },
        series: [
          {
            type: "tree",
            data: [treeData],
            top: 24,
            left: 120,
            right: 160,
            bottom: 24,
            symbol: "circle",
            symbolSize: (value: number) => symbolSizeFor(value, maxValue),
            orient,
            expandAndCollapse: true,
            initialTreeDepth,
            roam: true,
            edgeShape: "curve",
            edgeForkPosition: "50%",
            label: {
              position: orient === "LR" ? "left" : "top",
              verticalAlign: "middle",
              align: orient === "LR" ? "right" : "center",
              color: token.colorText,
              fontSize: 12,
              formatter: (params: { name: string; value: number }) =>
                `${params.name} · ${params.value}`,
            },
            leaves: {
              label: {
                position: orient === "LR" ? "right" : "bottom",
                verticalAlign: "middle",
                align: orient === "LR" ? "left" : "center",
              },
            },
            itemStyle: {
              color: token.colorPrimary,
              borderColor: token.colorBgContainer,
              borderWidth: 1,
            },
            lineStyle: { color: token.colorBorderSecondary, width: 1 },
            emphasis: { focus: "descendant" },
            animationDuration: 400,
            animationDurationUpdate: 300,
          },
        ],
      },
      { notMerge: true },
    )
  }, [
    treeData,
    maxValue,
    orient,
    initialTreeDepth,
    token.colorText,
    token.colorPrimary,
    token.colorBorderSecondary,
    token.colorBgContainer,
    token.colorBgElevated,
  ])

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
}
