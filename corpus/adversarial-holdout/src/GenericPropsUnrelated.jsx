import marked from "marked";

function GenericPropsChild(props) {
  return <div dangerouslySetInnerHTML={{ __html: props.trustedHtml }} />;
}

export function GenericPropsParent({ input, trustedHtml }) {
  const unsafe = marked(input);
  return <GenericPropsChild unsafe={unsafe} trustedHtml={trustedHtml} />;
}
