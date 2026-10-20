/** 按语言名哈希出稳定的颜色，用来画语言色点 */
export function languageColor(language: string): string {
  let hash = 0
  for (let i = 0; i < language.length; i++) {
    hash = (hash << 5) - hash + language.charCodeAt(i)
  }
  return `hsl(${Math.abs(hash) % 360}, 65%, 50%)`
}
