import { useMemo } from "react";
import { serializeState } from "../serialization/serializeState";
import { loadInitialState } from "../state/loadInitialState";

export function useBootstrapScript(payload) {
  return useMemo(() => serializeState(loadInitialState(payload)), [payload]);
}
