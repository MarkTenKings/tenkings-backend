// Verbatim Pokémon-only additions from Inventory 60572cec; sports continues to
// use the exact V1 request. Golden fixtures compare to the actual source builder.
const INSTRUCTIONS = [
  'POKÉMON ONLY: First confirm from the photos that this is a Pokémon TCG card. Only for that game, use the following field conventions instead of the manufacturer/year/set/variant restrictions above. All other rules, and every rule for sports or other games, remain unchanged.',
  'Pokémon manufacturer is the visibly printed publisher/brand. A Pokémon copyright line or wordmark supports Pokémon. If a specific publisher such as Wizards of the Coast is printed, use that instead. Do not invent an unprinted legal company name.',
  'Pokémon year may be the single legible copyright year printed on this card. Quote that year and its location. Never adjust it to a memorized expansion release date; ambiguous multiple years stay unknown.',
  'Pokémon set_name: inspect the small expansion symbol near the collector number on older cards and the printed expansion code on newer cards. Decode an unambiguously recognized symbol/code into its expansion name only when consistent with the visible card name and complete collector number. This is recognition of a printed set identifier, not permission to guess a set from the character alone. Preserve a clearly identified subset. A regulation letter, rarity symbol, or RC/TG/GG prefix alone does not identify an expansion. If the symbol/code cannot be resolved confidently, leave the set unknown.',
  'Use the supplied front detail crop to read small print. Never change an uncertain collector number or year to make it fit a guessed expansion. When the symbol, number, year or visible attack text conflict, leave the disputed fields unknown instead of fabricating matching evidence.',
  'Pokémon variant: a legible edition stamp or unmistakable visible foil treatment can support a descriptive suggestion such as 1st Edition, Holofoil, or Reverse Holofoil. Describe the actual stamp or foil region in the evidence; visual finish suggestions are at most medium confidence. A rarity mark, RC prefix, shiny sleeve, glare, or lack of reflection alone is insufficient. Never default an uncertain finish to Standard or Non-Holo, and never infer a named special foil from catalog memory.',
];

export function buildPokemonRequestV2(request, crop) {
  return { ...request, instructions: [request.instructions, ...INSTRUCTIONS].join(' '),
    input: [{ role: 'user', content: [...request.input[0].content,
      { type: 'input_text', text: 'Detail view of the lower half of the same Front photo, for its small copyright line, collector number and expansion symbol. This is a crop of the verified photo, not another card or independent evidence.' },
      { type: 'input_image', image_url: `data:image/png;base64,${crop.toString('base64')}`, detail: 'high' },
    ] }],
  };
}
