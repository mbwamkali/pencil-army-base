type Attr = string | number | boolean | null | undefined | ((e: any) => void);
export type Child = Node | string | number | null | undefined | false | Child[];

const SVG_NS = "http://www.w3.org/2000/svg";

function apply(node: Element, attrs: Record<string, Attr>, children: Child[]): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "class") node.setAttribute("class", String(value));
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  const add = (c: Child): void => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else node.append(typeof c === "number" ? String(c) : c);
  };
  children.forEach(add);
}

/** Create an HTML element. Attributes starting with "on" are event listeners ("onclick"). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, Attr> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  apply(node, attrs, children);
  return node;
}

/** Create an SVG element. */
export function sv<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, Attr> = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  apply(node, attrs, children);
  return node;
}
