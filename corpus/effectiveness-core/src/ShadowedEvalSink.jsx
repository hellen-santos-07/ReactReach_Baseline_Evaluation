const marked = require("marked");

function ShadowedEvalSink({ input, safeEval }) {
  const rendered = marked(input);
  const eval = safeEval;
  const result = eval(rendered);
  return <pre>{result}</pre>;
}
