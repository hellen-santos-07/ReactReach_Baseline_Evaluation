const serialize = require("serialize-javascript");

export function SerializeDirectScriptHtml({ initialState }) {
  return <script dangerouslySetInnerHTML={{ __html: `window.__STATE__=${serialize(initialState)}` }} />;
}
