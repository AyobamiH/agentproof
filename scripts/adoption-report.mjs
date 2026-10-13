#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { summariseRecords } from "./lib/adoption.mjs";

try {
  const files = process.argv.slice(2);
  if (files.length > 1000 || files.some(f => f.startsWith("-"))) throw new Error("explicit_record_paths_required");
  const records = [];
  for (const file of files) {
    if ((await stat(file)).size > 256 * 1024) throw new Error("record_too_large");
    records.push(JSON.parse(await readFile(file, "utf8")));
  }
  console.log(JSON.stringify(summariseRecords(records), null, 2));
} catch (error) {
  // Validation errors describe fields, never repeat submitted observation values.
  console.error(error.message?.startsWith("invalid_adoption_record:") ? error.message : "adoption_report_rejected");
  process.exitCode = 2;
}
