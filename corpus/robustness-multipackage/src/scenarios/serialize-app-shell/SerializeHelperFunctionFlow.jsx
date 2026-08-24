import { buildBootstrapScript } from "./bootstrap/buildBootstrapScript";

export function SerializeHelperFunctionFlow({ initialState }) {
  const scriptBody = buildBootstrapScript(initialState);
  return <script dangerouslySetInnerHTML={{ __html: scriptBody }} />;
}
