/**
 * CommonJS entry of `@openpush/web`: `require("@openpush/web")` is the `OpenPush` object itself.
 * The named exports stay reachable as non-enumerable properties of it (`require(...).OpenPushError`).
 */
import * as named from "../index";
import { withNamed } from "./named";

export default withNamed(named.default, named);
