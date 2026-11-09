/**
 * In-app browsers (the web views inside social and messaging apps). They cannot receive web
 * push, so push prompts stay hidden there. Keep this list maintained; each entry is a
 * user-agent marker the app adds to its web view.
 */
export const IN_APP_BROWSER_MARKERS: readonly RegExp[] = [
  /FBAN\/|FBAV\/|FB_IAB|FBIOS/i, // Facebook and Messenger
  /Instagram/i,
  /\bLine\//i,
  /MicroMessenger/i, // WeChat
  /\bTwitter/i,
  /Snapchat/i,
  /musical_ly|BytedanceWebview|\bTikTok|trill_/i,
  /LinkedInApp/i,
  /\bPinterest/i,
  /KAKAOTALK/i,
  /NAVER\(inapp/i,
  /\bGSA\//, // Google app on iOS
  /\bReddit\//i,
  /; wv\)/, // Android System WebView
];

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_BROWSER_MARKERS.some((marker) => marker.test(userAgent));
}
