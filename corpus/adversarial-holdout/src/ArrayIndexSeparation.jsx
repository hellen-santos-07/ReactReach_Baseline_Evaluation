import marked from "marked";

export function ArrayIndexSeparation({ input, trustedHtml }) {
  const values = [marked(input), trustedHtml];
  return <div dangerouslySetInnerHTML={{ __html: values[1] }} />;
}
