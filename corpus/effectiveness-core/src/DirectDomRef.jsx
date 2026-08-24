import { useRef } from "react";
import marked from "marked";

export function DirectDomRef({ input }) {
  const contentRef = useRef(null);
  contentRef.current.innerHTML = marked(input);
  return <div ref={contentRef} />;
}
