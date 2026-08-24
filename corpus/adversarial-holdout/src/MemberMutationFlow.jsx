import marked from "marked";

export function MemberMutationFlow({ input }) {
  const payload = {};
  payload.html = marked(input);
  return <div dangerouslySetInnerHTML={{ __html: payload.html }} />;
}
