import { ArticleContent } from "./components/ArticleContent";
import { reviewedArticleHtml } from "./policies/contentPolicy";
import { buildArticlePayload } from "./services/sanitizer";

export function DompurifyPropertySeparation({ rawHtml }) {
  const payload = buildArticlePayload(rawHtml, reviewedArticleHtml());
  return <ArticleContent html={payload.reviewedHtml} />;
}
