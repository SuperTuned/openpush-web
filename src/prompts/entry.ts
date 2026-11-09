/**
 * `openpush-prompts.js`: the prompt UI, loaded by `openpush.js` only when a prompt
 * applies to the page or `OpenPush.Prompts.*` is called. It puts itself on
 * `globalThis.OpenPushPrompts`, where the loader finds it (a bundle that imports this file gets the
 * prompts without a network load).
 */
import { VERSION } from "../version";
import { PromptsController } from "./controller";
import type { PromptsChunk } from "./types";

export const promptsChunk: PromptsChunk = {
  version: VERSION,
  create: (host) => new PromptsController(host),
};

(globalThis as { OpenPushPrompts?: PromptsChunk }).OpenPushPrompts = promptsChunk;
