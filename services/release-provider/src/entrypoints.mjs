import { WorkerEntrypoint } from "cloudflare:workers";
import worker from "./worker.mjs";
import { recoveryRpc } from "./readback-recovery.mjs";
export { ReleaseFence, ReleaseReceiptLedger } from "./worker.mjs";

// A named service binding has no public HTTP route and no publication method.
export class ReleaseRecovery extends WorkerEntrypoint {
  observe(input) { return recoveryRpc(this.env, "observe", input); }
  sign(input) { return recoveryRpc(this.env, "sign", input); }
}
export default worker;
