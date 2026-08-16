import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const extensions = require.extensions as unknown as Record<
  string,
  (module: NodeModule & { exports: unknown }) => void
>;
extensions[".css"] = () => undefined;
extensions[".png"] = (module) => {
  module.exports = { src: "/ten-kings-crown.png", width: 100, height: 65 };
};

const editorModulePromise = import("../components/human-grade/SharedLabelEditor");

test("completed Speedster identity editor locks category, omits grade controls, and honors its one Save label", async () => {
  const { default: SharedLabelEditor } = await editorModulePromise;
  const props = {
    mode: "SPEEDSTER",
    editing: true,
    lockCardType: true,
    primaryActionLabel: "Save Authoritative Identity",
    certificateNumber: "TKH-000001",
    value: {
      cardType: "SPORTS",
      playerName: "Nick Bosa",
      cardName: "",
      layoutType: "",
      year: "2021",
      manufacturer: "Panini",
      productSet: "Obsidian",
      parallel: "Orange",
      insert: "",
      cardNumber: "12",
      centeringGrade: "",
      cornersGrade: "",
      edgesGrade: "",
      surfaceGrade: "",
    },
    onChange() { return undefined; },
    onSubmit() { return undefined; },
  } as const;
  const html = renderToStaticMarkup(React.createElement(SharedLabelEditor, props));

  assert.match(html, /Edit Speedster Identity/);
  assert.match(html, />Save Authoritative Identity<\/button>/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Sports<\/button>/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Pokémon<\/button>/);
  assert.match(html, /value="Nick Bosa"/);
  assert.doesNotMatch(html, /aria-label="Centering"|type="number"/);
  assert.doesNotMatch(html, /Pokémon layout type/);
  assert.doesNotMatch(html, /Continue to Photos/);
  const savingHtml = renderToStaticMarkup(React.createElement(SharedLabelEditor, { ...props, saving: true }));
  assert.match(savingHtml, />Saving…<\/button>/);
  assert.doesNotMatch(savingHtml, /Preparing…/);
});

test("new Pokemon Speedster identity editor exposes the authoritative layout selector", async () => {
  const { default: SharedLabelEditor } = await editorModulePromise;
  const html = renderToStaticMarkup(React.createElement(SharedLabelEditor, {
    mode: "SPEEDSTER",
    requirePokemonLayoutType: true,
    value: {
      cardType: "POKEMON",
      playerName: "",
      cardName: "Squirtle",
      layoutType: "POKEMON",
      year: "2023",
      manufacturer: "",
      productSet: "MEW EN",
      parallel: "Reverse Holo",
      insert: "",
      cardNumber: "007/165",
      centeringGrade: "",
      cornersGrade: "",
      edgesGrade: "",
      surfaceGrade: "",
    },
    onChange() { return undefined; },
    onSubmit() { return undefined; },
  }));
  assert.match(html, /aria-label="Pokémon layout type"/);
  assert.match(html, /value="POKEMON" selected=""/);
  assert.match(html, />TRAINER</);
  assert.match(html, />ENERGY</);
});
