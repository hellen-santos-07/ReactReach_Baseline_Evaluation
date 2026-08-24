import marked from "marked";

export function UnrelatedSink({ input, trustedHtml }) {
  const rendered = marked(input);
  return (
    <section>
      <pre>{rendered}</pre>
      <div dangerouslySetInnerHTML={{ __html: trustedHtml }} />
    </section>
  );
}
