/**
 * Methods the reference removed in its current major version. Each one logs a
 * single warning naming its replacement and does nothing.
 */
export const REMOVED_METHODS: Readonly<Record<string, string>> = {
  registerForPushNotifications: "Notifications.requestPermission()",
  showNativePrompt: "Notifications.requestPermission()",
  showHttpPrompt: "Slidedown.promptPush()",
  showSlidedownPrompt: "Slidedown.promptPush()",
  showCategorySlidedown: "Slidedown.promptPushCategories()",
  sendSelfNotification: "a test push from the OpenPush console",
  isPushNotificationsSupported: "Notifications.isPushSupported()",
  isPushNotificationsEnabled: "User.PushSubscription.optedIn",
  getNotificationPermission: "Notifications.permission",
  getSubscription: "User.PushSubscription.optedIn",
  setSubscription: "User.PushSubscription.optIn() or optOut()",
  isOptedOut: "User.PushSubscription.optedIn",
  getUserId: "User.PushSubscription.id",
  setExternalUserId: "login(externalId)",
  removeExternalUserId: "logout()",
  getExternalUserId: "User.externalId",
  sendTag: "User.addTag(key, value)",
  sendTags: "User.addTags(tags)",
  getTags: "User.getTags()",
  deleteTag: "User.removeTag(key)",
  deleteTags: "User.removeTags(keys)",
  provideUserConsent: "setConsentGiven(true)",
  setEmail: "User.addEmail(address)",
  setSMSNumber: "User.addSms(number)",
  addListenerForNotificationOpened: 'Notifications.addEventListener("click", fn)',
  on: "addEventListener on Notifications, User.PushSubscription or Slidedown",
  off: "removeEventListener on Notifications, User.PushSubscription or Slidedown",
  once: "addEventListener on Notifications, User.PushSubscription or Slidedown",
};
