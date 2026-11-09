/** CommonJS entry of `@openpush/web/compat`: `require("@openpush/web/compat")` is the compat object. */
import * as named from "../../compat/npm";
import { withNamed } from "./named";

export default withNamed(named.default, named);
