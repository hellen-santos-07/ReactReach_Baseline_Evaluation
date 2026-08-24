import marked from "marked";

export function LocalPropagation({ input }) {
  const rendered = marked(input);
  return <div dangerouslySetInnerHTML={{ __html: rendered }} />;
}
