import { serializeState } from "../serialization/serializeState";
import { normalizeState } from "../state/normalizeState";

export function buildBootstrapScript(initialState) {
  return `window.__STATE__=${serializeState(normalizeState(initialState))}`;
}
