import { useMemo } from "react";
import marked from "marked";

export function UseMemoPropagation({ input }) {
  const html = useMemo(() => marked(input), [input]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
