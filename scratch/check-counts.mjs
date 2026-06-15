import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { searchMfds } = require("../lib/mfds.js");

async function check(ingredient) {
  const res = await searchMfds({ ingredient1: ingredient });
  console.log(`Ingredient: ${ingredient}, Total results: ${res.total}`);
}

async function run() {
  await check("세티리진");
  await check("로라타딘");
}
run();
