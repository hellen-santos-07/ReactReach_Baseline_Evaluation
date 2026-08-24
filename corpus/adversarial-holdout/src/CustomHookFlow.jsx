import marked from "marked";

function useRenderedMarkdown(input) {
  return marked(input);
}

export function CustomHookFlow({ input }) {
  const html = useRenderedMarkdown(input);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
