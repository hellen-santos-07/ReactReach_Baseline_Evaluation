import { useRef } from "react";
import { useBootstrapScript } from "./hooks/useBootstrapScript";

export function SerializeLocalInsertAdjacent({ payload }) {
  const containerRef = useRef(null);
  const scriptBody = useBootstrapScript(payload);
  containerRef.current.insertAdjacentHTML("beforeend", `<script>${scriptBody}</script>`);
  return <div ref={containerRef} />;
}
