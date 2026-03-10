import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppScrollArea } from "../../src/components/ui/AppScrollArea";

describe("AppScrollArea", () => {
  it("applies default classes", () => {
    const html = renderToStaticMarkup(React.createElement(AppScrollArea, { id: "default" }));
    assert.match(html, /class="[^"]*app-scroll[^"]*app-scroll-y[^"]*app-scroll-gutter/);
  });

  it("supports variant and axis overrides", () => {
    const html = renderToStaticMarkup(
      React.createElement(AppScrollArea, {
        axis: "x",
        variant: "hidden",
        stableGutter: false,
      }),
    );
    assert.match(html, /class="[^"]*app-scroll[^"]*app-scroll-x[^"]*app-scroll-hidden/);
    assert.doesNotMatch(html, /app-scroll-gutter/);
  });

  it("sets route marker when requested", () => {
    const html = renderToStaticMarkup(React.createElement(AppScrollArea, { dataScrollRoot: true }));
    assert.match(html, /data-scroll-root="route"/);
  });
});
