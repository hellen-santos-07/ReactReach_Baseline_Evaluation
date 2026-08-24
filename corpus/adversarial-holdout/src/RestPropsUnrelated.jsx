import marked from "marked";

function RestPropsChild({ ...rest }) {
  return <div dangerouslySetInnerHTML={{ __html: rest.trustedHtml }} />;
}

export function RestPropsParent({ input, trustedHtml }) {
  const unsafe = marked(input);
  return <RestPropsChild unsafe={unsafe} trustedHtml={trustedHtml} />;
}
