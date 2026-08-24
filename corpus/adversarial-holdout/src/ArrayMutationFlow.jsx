import marked from "marked";

export function ArrayMutationFlow({ input }) {
  const values = [];
  values.push(marked(input));
  const html = values[0];
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
