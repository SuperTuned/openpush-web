# @openpush/vue

OpenPush web push for Vue 3. A thin layer over `@openpush/web`.

## Install

```sh
npm install @openpush/web @openpush/vue
npx @openpush/web worker public
```

The second line writes `public/openpush-sw.js`, the worker file your site serves from its root.

## Use

```js
// main.js
import { createApp } from "vue";
import { OpenPushPlugin } from "@openpush/vue";
import App from "./App.vue";

createApp(App).use(OpenPushPlugin, { appId: "your-app-id" }).mount("#app");
```

```vue
<script setup>
import { useOpenPush } from "@openpush/vue";

const { OpenPush, optedIn } = useOpenPush();
</script>

<template>
  <p v-if="optedIn">Notifications are on.</p>
  <button v-else @click="OpenPush.Notifications.requestPermission()">Get notifications</button>
</template>
```

`useOpenPush()` gives the `OpenPush` object and read-only refs `permission`, `optedIn`,
`subscriptionId` and `externalId`. Templates also reach the object as `$openpush`. OpenPush
initializes once per page load; during server-side rendering the plugin does nothing else.

The OpenPush prompt UI loads on demand the first time a prompt shows. To bundle it with your app
instead, add `import "@openpush/web/prompts";` once, next to where you set up OpenPush. See the
[Web SDK README](https://github.com/SuperTuned/openpush-web#readme) for where the SDK files are
served from, and for moving from another push SDK.
