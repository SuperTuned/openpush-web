/** The default wording by base language. */
import type { Strings } from "./strings";
import { en } from "./en";
import { es } from "./es";
import { pt } from "./pt";
import { fr } from "./fr";
import { de } from "./de";
import { it } from "./it";
import { ja } from "./ja";
import { ko } from "./ko";
import { zh } from "./zh";
import { hi } from "./hi";
import { id } from "./id";
import { tr } from "./tr";
import { ru } from "./ru";
import { ar } from "./ar";

export const DEFAULT_LANGUAGE = "en";

export const LANGUAGES: Readonly<Record<string, Strings>> = { en, es, pt, fr, de, it, ja, ko, zh, hi, id, tr, ru, ar };

/** Languages written right to left. */
export const RTL_LANGUAGES: readonly string[] = ["ar", "he", "fa", "ur"];
