import marked from "marked";

export function UnrelatedJsxUrl({ input, trustedUrl }) {
  const rendered = marked(input);
  return (
    <section>
      <pre>{rendered}</pre>
      <a href={trustedUrl}>Trusted destination</a>
    </section>
  );
}
