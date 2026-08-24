export function DynamicImportNoBinding() {
  import("marked");
  return <p>The dynamic import has no captured binding.</p>;
}
