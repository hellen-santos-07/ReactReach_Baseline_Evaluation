const marked = require("marked");

export function RequireDirectEval({ input }) {
  const execute = () => eval(marked(input));
  return <button onClick={execute}>Execute</button>;
}
