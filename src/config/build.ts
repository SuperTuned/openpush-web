/**
 * Build-time origins, kept in this one file.
 *
 * PRODUCTION_API_ORIGIN is the server the hosted build talks to when the page does not pass
 * `serverUrl`.
 */
export const PRODUCTION_API_ORIGIN = "https://app.openpush.ai";

/**
 * The origin that serves the hosted SDK files at `/sdk/web/v2/` and `/sdk/web/<version>/`. A script
 * loaded from here uses PRODUCTION_API_ORIGIN.
 */
export const SDK_ORIGIN = "https://app.openpush.ai";
