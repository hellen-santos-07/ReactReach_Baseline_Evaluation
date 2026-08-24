import DOMPurify from "dompurify";
import { reviewedArticleHtml } from "./contentPolicy";

export function DompurifyOverwrittenBinding({ rawHtml }) {
  let html = DOMPurify.sanitize(rawHtml);
  html = reviewedArticleHtml();
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
