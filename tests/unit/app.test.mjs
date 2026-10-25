import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appJs = fs.readFileSync(path.join(root, "dressme/js/app.js"), "utf8");

test("DressMe.boot updates status element", () => {
  const status = { textContent: "before" };
  const document = {
    readyState: "complete",
    getElementById(id) {
      return id === "status" ? status : null;
    },
    addEventListener() {},
  };
  const window = { DressMe: undefined };
  window.document = document;
  const context = { window, document };
  vm.createContext(context);
  vm.runInContext(appJs, context);
  context.window.DressMe.boot();
  assert.match(status.textContent, /Scaffold placeholder/i);
});
