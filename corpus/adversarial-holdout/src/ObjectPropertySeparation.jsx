import marked from "marked";

export function ObjectPropertySeparation({ input, trustedHtml }) {
  const payload = {
    unsafe: marked(input),
    safe: trustedHtml,
  };
  return <div dangerouslySetInnerHTML={{ __html: payload.safe }} />;
}
