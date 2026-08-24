import { useState } from "react";
import marked from "marked";

export function AsyncSetterFlow({ input }) {
  const [html, setHtml] = useState("");
  Promise.resolve(input).then((value) => setHtml(marked(value)));
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
