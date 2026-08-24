import marked from "marked";

function SafeTerminal({ content }) {
  return <pre>{content}</pre>;
}

function SafeIntermediate({ content }) {
  return <SafeTerminal content={content} />;
}

export function MultiHopSafeTerminal({ input }) {
  const rendered = marked(input);
  return <SafeIntermediate content={rendered} />;
}
