import marked from "marked";

export function ComponentWithoutSink({ input }) {
  const rendered = marked(input);
  return <pre>{rendered}</pre>;
}
