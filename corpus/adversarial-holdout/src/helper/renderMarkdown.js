import marked from "marked";

export function renderMarkdown(input) {
  return marked(input);
}
