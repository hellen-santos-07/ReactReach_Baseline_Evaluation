import marked from "marked";

export function UnrelatedLocationSink({ input, trustedUrl }) {
  const rendered = marked(input);
  window.location.href = trustedUrl;
  return <pre>{rendered}</pre>;
}
