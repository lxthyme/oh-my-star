/** 标签名称最大长度（字符数） */
export const TAG_NAME_MAX_LENGTH = 50

/** 标签描述最大长度（字符数） */
export const TAG_DESCRIPTION_MAX_LENGTH = 500

/** 标签层级最大深度（1 级 = 顶级标签） */
export const TAG_MAX_DEPTH = 5

/**
 * 专用标签名：删除带子标签的标签时，子标签先移到这里。
 * 仅表示"父标签已被删除，待你重新安排归属"，不是一般意义上的「未分类」。
 */
export const ORPHAN_TAG_NAME = "已删除待处理"
