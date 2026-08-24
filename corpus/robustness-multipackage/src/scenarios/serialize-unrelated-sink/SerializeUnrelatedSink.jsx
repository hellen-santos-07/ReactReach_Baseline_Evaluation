import serialize from "serialize-javascript";
import { reviewedBootstrap } from "./reviewedBootstrap";
import { StatePreview } from "./StatePreview";

export function SerializeUnrelatedSink({ initialState }) {
  const serialized = serialize(initialState);
  const reviewedScript = reviewedBootstrap();
  return (
    <section>
      <StatePreview serialized={serialized} />
      <script dangerouslySetInnerHTML={{ __html: reviewedScript }} />
    </section>
  );
}
