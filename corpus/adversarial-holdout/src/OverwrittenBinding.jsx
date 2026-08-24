import marked from "marked";

export function OverwrittenBinding({ input, trustedHtml }) {
  let html = marked(input);
  html = trustedHtml;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
