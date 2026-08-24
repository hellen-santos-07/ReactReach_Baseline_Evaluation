import { renderMarkdown } from "./helper/renderMarkdown";

export function HelperFunctionFlow({ input }) {
  const html = renderMarkdown(input);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
