import DOMPurify from "dompurify";

export function buildArticlePayload(rawHtml, reviewedHtml) {
  return {
    dependencyOutput: DOMPurify.sanitize(rawHtml),
    reviewedHtml,
  };
}
