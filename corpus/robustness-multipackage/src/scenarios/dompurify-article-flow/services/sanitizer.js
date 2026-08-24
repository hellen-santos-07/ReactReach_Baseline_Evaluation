import DOMPurify from "dompurify";

export function sanitizeArticle(rawHtml) {
  return DOMPurify.sanitize(rawHtml);
}
