import assert from "node:assert/strict";
import { test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { captureNodePageQuery } from "../../helpers/files-node-page-query";

const project = "11111111-1111-4111-8111-111111111111";
const encode = (data: object) => Buffer.from(JSON.stringify({ v: 2, sort: "name", rank: 1, id: "00000000-0000-4000-8000-000000000000", name: "İ:::file", ...data })).toString("base64url");
test("pagination uses parameterized, database-normalized cursor names", async () => {
  const page = await captureNodePageQuery(project, "name", encode({}));
  const query = new PgDialect().sqlToQuery(page.where);
  assert.ok(query.params.includes("İ:::file"));
  assert.match(query.sql, /lower\(\$\d+::text\) COLLATE "C"/);
  assert.match(query.sql, /and \(CASE WHEN/);
  assert.equal(page.limit, 3, "two rows plus next-page sentinel");
});
test("malformed, legacy and mismatched-sort cursors fail before reading files", async () => {
  for (const cursor of ["not-json", encode({ rank: 9 }), encode({ id: "foreign" }), encode({ v: 1 }), encode({ sort: "updated" })]) {
    await assert.rejects(captureNodePageQuery(project, "name", cursor), /Invalid project nodes cursor/);
  }
});
