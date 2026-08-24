import marked from "marked";

function FinalHtmlSink({ html }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function IntermediateComponent({ content }) {
  return <FinalHtmlSink html={content} />;
}

export function MultiHopPropagation({ input }) {
  const rendered = marked(input);
  return <IntermediateComponent content={rendered} />;
}
