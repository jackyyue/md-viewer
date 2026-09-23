// HTML 转义。渲染器和代码高亮都要用，所以放一处，不要各写一份。

/** 转义元素内容与属性值都需要的三个字符。 */
export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 放进属性值（双引号包围）时用这个。 */
export const escAttr = (s: string): string => esc(s).replace(/"/g, '&quot;')
