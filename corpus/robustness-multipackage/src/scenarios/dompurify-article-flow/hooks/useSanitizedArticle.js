import { useMemo } from "react";
import { sanitizeArticle } from "../services/sanitizer";

export function useSanitizedArticle(rawHtml) {
  return useMemo(() => sanitizeArticle(rawHtml), [rawHtml]);
}
