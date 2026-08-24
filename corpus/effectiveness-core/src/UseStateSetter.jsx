import { useState } from "react";
import marked from "marked";

export function UseStateSetter({ input }) {
  const [html, setHtml] = useState("");
  setHtml(marked(input));
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
