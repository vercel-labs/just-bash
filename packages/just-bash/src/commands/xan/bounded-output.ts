import { BoundedStringBuilder } from "../../bounded-builder.js";

export class XanOutputBuilder extends BoundedStringBuilder {
  constructor(maxBytes: number) {
    super(maxBytes, "xan");
  }
}
