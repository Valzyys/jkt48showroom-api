import { buildDocsUI } from "./build-docs-ui.js";
import { loadPublicDocumentation } from "./public-docs.js";
import { writeFile } from "node:fs/promises";
const assets = await buildDocsUI();
const { catalog, responses } = await loadPublicDocumentation();
await writeFile(
  new URL("../src/docs/assets.js", import.meta.url),
  "export const assets = " +
    JSON.stringify(assets) +
    ";\nexport const catalog = " +
    JSON.stringify(catalog) +
    ";\nexport const responses = " +
    JSON.stringify(responses) +
    ";\n",
);
console.log(
  `Documentation prepared: ${catalog.routes.length} method/route combinations.`,
);
