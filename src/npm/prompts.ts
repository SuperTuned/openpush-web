/**
 * `@openpush/web/prompts`: the prompt UI in the bundle. Importing it registers
 * `globalThis.OpenPushPrompts`, so the SDK shows prompts without loading `openpush-prompts.js` from
 * the server.
 */
import { promptsChunk } from "../prompts/entry";

export default promptsChunk;
export { promptsChunk };
export type { PromptsChunk } from "../prompts/types";
