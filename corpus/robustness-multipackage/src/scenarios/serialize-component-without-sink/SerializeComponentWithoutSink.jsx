import serialize from "serialize-javascript";
import { StatePreview } from "./StatePreview";

export function SerializeComponentWithoutSink({ initialState }) {
  const serialized = serialize(initialState);
  return <StatePreview serialized={serialized} />;
}
