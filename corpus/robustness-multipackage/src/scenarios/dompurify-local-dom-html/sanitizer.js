import DOMPurify from "dompurify";

export function sanitizeHtml(rawHtml) {
  return DOMPurify.sanitize(rawHtml);
}
