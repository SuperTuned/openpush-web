/**
 * The default wording of every prompt, one file per language so translators can review
 * each on its own. `{site}` is replaced with the site name. Keys a site can override with
 * `wording` are the prompt wording keys; the rest (Home Screen steps, field errors, close) are SDK text.
 */
export interface SlideInStrings {
  message: string;
  allow: string;
  later: string;
  update_message: string;
  save: string;
  cancel: string;
  /** iPhone and iPad tabs, when the Home Screen steps are on. */
  ios_message: string;
  ios_step_share: string;
  ios_step_add: string;
  ios_step_open: string;
}

export interface BellStrings {
  tip_not_subscribed: string;
  tip_subscribed: string;
  tip_blocked: string;
  after_subscribe: string;
  after_unsubscribe: string;
  dialog_title: string;
  subscribe: string;
  unsubscribe: string;
  blocked_title: string;
  blocked_help: string;
  /** The bell's accessible name. */
  aria_label: string;
  close: string;
}

export interface ButtonStrings {
  subscribe: string;
  unsubscribe: string;
  /** Shown under the button when not empty. */
  explanation: string;
  blocked: string;
}

export interface EmailPhoneStrings {
  message: string;
  email_label: string;
  phone_label: string;
  submit: string;
  later: string;
  /** The same text whatever happened to the address. */
  confirm: string;
  code_label: string;
  code_submit: string;
  invalid_email: string;
  invalid_phone: string;
  code_wrong: string;
  error: string;
  close: string;
}

export interface VerifyStrings {
  message: string;
  allow: string;
  close: string;
}

export interface Strings {
  slide_in: SlideInStrings;
  bell: BellStrings;
  button: ButtonStrings;
  email_phone: EmailPhoneStrings;
  verify: VerifyStrings;
}

export type StringGroup = keyof Strings;
