# Image Placeholder Registry

This project uses labeled placeholders so designers can supply assets without guessing where they belong. Each placeholder renders a dashed box with its ID.

## Placeholder IDs

| ID    | Location                              | Notes                           |
|-------|---------------------------------------|---------------------------------|
| PI1   | Home hero trio container              | Encloses the three hero machines|
| PI1-L | Home hero trio (left slot)            | Pokémon machine graphic         |
| PI1-C | Home hero trio (center slot)          | Sports machine graphic          |
| PI1-R | Home hero trio (right slot)           | Comics machine graphic          |
| PI2   | (reserved)                            | add when ready                  |
| PI3   | (reserved)                            | add when ready                  |
| PI4   | (reserved)                            | add when ready                  |

## Swapping in real assets

1. Place the new asset under `frontend/nextjs-app/public/images/` using any filename.
2. Replace the `<PlaceholderImage label="..." />` element with a Next.js `<Image>` configured for that asset.
3. Remove or update the relevant entry from this table as needed.

This file should be updated whenever new placeholder slots are created.
