import marked from "marked";
import Target from "./Target";

export function SafeParent({ input }) {
  const content = marked(input);
  return <Target content={content} />;
}
