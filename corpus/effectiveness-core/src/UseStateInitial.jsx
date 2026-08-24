import { useState } from "react";
import marked from "marked";

export function UseStateInitial({ input }) {
  const [html] = useState(marked(input));
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
