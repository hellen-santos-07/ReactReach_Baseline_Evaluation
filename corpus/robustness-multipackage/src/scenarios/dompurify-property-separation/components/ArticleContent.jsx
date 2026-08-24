export function ArticleContent({ html }) {
  return <article dangerouslySetInnerHTML={{ __html: html }} />;
}
