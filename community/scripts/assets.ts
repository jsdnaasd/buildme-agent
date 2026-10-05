import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/fonts", { recursive: true });
for (const [font, weights] of [
  ["schibsted-grotesk", [400, 500, 600, 700]],
  ["jetbrains-mono", [400, 500, 600]],
] as const) {
  for (const weight of weights)
    cpSync(
      `node_modules/@fontsource/${font}/files/${font}-latin-${weight}-normal.woff2`,
      `public/fonts/${font}-latin-${weight}-normal.woff2`,
    );
  cpSync(
    `node_modules/@fontsource/${font}/LICENSE`,
    `public/fonts/${font}-LICENSE`,
  );
}
cpSync("src/db/migrations", "dist/src/db/migrations", { recursive: true });
