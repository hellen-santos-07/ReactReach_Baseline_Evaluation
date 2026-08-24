import { ArticleContent } from "./components/ArticleContent";
import { useSanitizedArticle } from "./hooks/useSanitizedArticle";

export function ArticlePage({ article }) {
  const sanitizedHtml = useSanitizedArticle(article.bodyHtml);
  return <ArticleContent html={sanitizedHtml} />;
}
