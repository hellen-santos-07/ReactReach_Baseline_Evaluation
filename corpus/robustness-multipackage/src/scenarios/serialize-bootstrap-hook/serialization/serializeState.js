import serialize from "serialize-javascript";

export function serializeState(state) {
  return `window.__STATE__=${serialize(state)}`;
}
