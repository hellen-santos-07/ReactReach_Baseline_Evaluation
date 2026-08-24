import { useReducer } from "react";
import marked from "marked";

export function UseReducerInitial({ input }) {
  const [html] = useReducer((state, next) => next, marked(input));
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
