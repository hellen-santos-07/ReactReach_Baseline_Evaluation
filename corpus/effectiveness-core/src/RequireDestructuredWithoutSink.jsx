const { parse } = require("marked");

export function RequireDestructuredWithoutSink({ input }) {
  const rendered = parse(input);
  return <pre>{rendered}</pre>;
}
