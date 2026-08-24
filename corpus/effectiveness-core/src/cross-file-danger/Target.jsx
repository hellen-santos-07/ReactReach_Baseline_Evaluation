export default function Target({ content }) {
  return <div dangerouslySetInnerHTML={{ __html: content }} />;
}
