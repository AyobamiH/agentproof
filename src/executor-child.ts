import path from "node:path";
import { LocalFileExecutor } from "./executor.js";
import { sha256 } from "./hash.js";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const request = JSON.parse(raw) as {
  root: string;
  target: string;
  contentBase64: string;
  expectedSha256: string;
};
const root = path.resolve(request.root);
const target = path.resolve(request.target);
const relative = path.relative(root, target);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
  throw new Error("executor_target_outside_authorized_root");
}
const content = Buffer.from(request.contentBase64, "base64");
if (sha256(content) !== request.expectedSha256) {
  throw new Error("executor_payload_digest_mismatch");
}
const result = await new LocalFileExecutor().replace(target, content);
process.stdout.write(JSON.stringify(result));
