declare const __OPENPUSH_VERSION__: string;

/** The SDK version, taken from package.json at build time. */
export const VERSION: string = __OPENPUSH_VERSION__;

/** The value sent as `sdk_version` with every registration. */
export const SDK_VERSION = `web/${VERSION}`;

/** Version of the page ↔ worker message protocol. */
export const PROTOCOL_VERSION = 2;
