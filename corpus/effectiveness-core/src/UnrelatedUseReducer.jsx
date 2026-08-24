import { useReducer } from "react";
import marked from "marked";

export function UnrelatedUseReducer({ input, trustedHtml }) {
  const rendered = marked(input);
  const [safeHtml] = useReducer((state, next) => next, trustedHtml);
  return (
    <section>
      <pre>{rendered}</pre>
      <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
    </section>
  );
}
