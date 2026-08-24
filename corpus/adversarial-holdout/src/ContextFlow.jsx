import { createContext, useContext } from "react";
import marked from "marked";

const MarkdownContext = createContext("");

function ContextConsumer() {
  const html = useContext(MarkdownContext);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ContextProvider({ input }) {
  const rendered = marked(input);
  return (
    <MarkdownContext.Provider value={rendered}>
      <ContextConsumer />
    </MarkdownContext.Provider>
  );
}
