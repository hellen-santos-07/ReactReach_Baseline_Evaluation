export function SerializeDynamicImportNoBinding() {
  import("serialize-javascript");
  return <div>Deferred loader</div>;
}
