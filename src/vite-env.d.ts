/// <reference types="vite/client" />

/** Vite 的 ?inline CSS 导入：返回 CSS 文本 */
declare module '*.css?inline' {
  const css: string
  export default css
}
