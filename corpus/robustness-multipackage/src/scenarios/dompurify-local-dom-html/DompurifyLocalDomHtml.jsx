import { useRef } from "react";
import { sanitizeHtml } from "./sanitizer";

export function DompurifyLocalDomHtml({ rawHtml }) {
  const contentRef = useRef(null);
  const cleanHtml = sanitizeHtml(rawHtml);
  contentRef.current.innerHTML = cleanHtml;
  return <article ref={contentRef} />;
}
