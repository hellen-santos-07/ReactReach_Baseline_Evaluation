import marked from "marked";

export function ScopeShadowing({ input }) {
  const rendered = marked(input);
  function execute(marked) {
    return eval(marked);
  }
  return <button onClick={() => execute("safe")}>{rendered}</button>;
}
