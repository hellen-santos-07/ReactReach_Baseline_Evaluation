import marked from "marked";

export function DirectNewFunction({ input }) {
  const generated = new Function(marked(input));
  return <button onClick={generated}>Execute generated code</button>;
}
