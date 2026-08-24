import { useCallback } from "react";
import marked from "marked";

export function UseCallbackPropagation({ input }) {
  const makeHtml = useCallback(() => marked(input), [input]);
  const html = makeHtml();
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
