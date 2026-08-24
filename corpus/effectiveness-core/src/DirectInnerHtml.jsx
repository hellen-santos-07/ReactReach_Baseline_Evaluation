import { marked } from "marked";

export function DirectInnerHtml({ input }) {
  return <div dangerouslySetInnerHTML={{ __html: marked(input) }} />;
}
