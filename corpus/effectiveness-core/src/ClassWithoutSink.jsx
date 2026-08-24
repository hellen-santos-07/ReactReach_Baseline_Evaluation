import React from "react";
import marked from "marked";

export class ClassWithoutSink extends React.Component {
  render() {
    const rendered = marked(this.props.input);
    return <pre>{rendered}</pre>;
  }
}
