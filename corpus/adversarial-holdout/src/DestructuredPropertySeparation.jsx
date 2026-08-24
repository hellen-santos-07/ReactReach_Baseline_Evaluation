import marked from "marked";

export function DestructuredPropertySeparation({ input, trustedHtml }) {
  const payload = {
    unsafe: marked(input),
    safe: trustedHtml,
  };
  const { safe } = payload;
  return <div dangerouslySetInnerHTML={{ __html: safe }} />;
}
