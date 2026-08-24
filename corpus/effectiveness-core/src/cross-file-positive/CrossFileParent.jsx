import marked from "marked";
import { HtmlSink } from "./HtmlSink";

export function CrossFileParent({ input }) {
  const html = marked(input);
  return <HtmlSink html={html} />;
}
