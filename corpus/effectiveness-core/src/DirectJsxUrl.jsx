import marked from "marked";

export function DirectJsxUrl({ input }) {
  return <a href={marked(input)}>Open</a>;
}
