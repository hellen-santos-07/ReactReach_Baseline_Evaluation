import { useRef } from "react";
import marked from "marked";

export function InsertAdjacentHtmlPropagation({ input }) {
  const contentRef = useRef(null);
  const html = marked(input);
  contentRef.current.insertAdjacentHTML("beforeend", html);
  return <div ref={contentRef} />;
}
