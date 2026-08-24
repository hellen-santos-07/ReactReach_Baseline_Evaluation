import DOMPurify from "dompurify";

export function DompurifyDirectInnerHtml({ rawHtml }) {
  return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(rawHtml) }} />;
}
