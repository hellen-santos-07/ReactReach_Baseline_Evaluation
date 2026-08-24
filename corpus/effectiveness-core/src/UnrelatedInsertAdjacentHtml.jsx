import { useRef } from "react";
import marked from "marked";

export function UnrelatedInsertAdjacentHtml({ input, trustedHtml }) {
  const contentRef = useRef(null);
  const rendered = marked(input);
  contentRef.current.insertAdjacentHTML("beforeend", trustedHtml);
  return <pre ref={contentRef}>{rendered}</pre>;
}
