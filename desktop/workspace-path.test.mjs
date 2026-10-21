import assert from "node:assert/strict";
import test from "node:test";

import { getDefaultWorkspacePath } from "./workspace-path.mjs";

test("默认工作区继续使用改名前的目录名", () => {
  assert.equal(getDefaultWorkspacePath("C:/Users/test/Documents"), "C:/Users/test/Documents/无限画布工作区");
});
