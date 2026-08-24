import serialize from "serialize-javascript";

export function serializeState(initialState) {
  return serialize(initialState);
}
