/**
 * `openpush-sw.js`: the site's worker file imports it with one line. Every listener is added
 * here, synchronously, while the script is evaluated.
 */
import { VERSION } from "../version";
import type { WorkerGlobalLike } from "./sw_types";
import { installWorker } from "./worker";

const scope = globalThis as unknown as WorkerGlobalLike & { OpenPushWorkerVersion?: string };
scope.OpenPushWorkerVersion = VERSION;
installWorker(scope);
