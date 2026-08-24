export function HtmlSink({ html }) {
  return <article dangerouslySetInnerHTML={{ __html: html }} />;
}
