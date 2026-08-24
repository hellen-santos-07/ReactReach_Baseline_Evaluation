import marked from "marked";

function HtmlView({ html }) {
  return <article dangerouslySetInnerHTML={{ __html: html }} />;
}

export function InterComponentPropagation({ input }) {
  const rendered = marked(input);
  return <HtmlView html={rendered} />;
}
