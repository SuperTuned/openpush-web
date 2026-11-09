# @openpush/react

OpenPush web push for React and Next.js. A thin layer over `@openpush/web`.

## Install

```sh
npm install @openpush/web @openpush/react
npx @openpush/web worker public
```

The second line writes `public/openpush-sw.js`, the worker file your site serves from its root.

## Use

```jsx
import { OpenPushProvider, useOpenPush } from "@openpush/react";

export default function App() {
  return (
    <OpenPushProvider options={{ appId: "your-app-id" }}>
      <Subscribe />
    </OpenPushProvider>
  );
}

function Subscribe() {
  const { OpenPush, optedIn } = useOpenPush();
  if (optedIn) return <p>Notifications are on.</p>;
  return <button onClick={() => OpenPush.Notifications.requestPermission()}>Get notifications</button>;
}
```

`useOpenPush()` gives the `OpenPush` object and `permission`, `optedIn`, `subscriptionId` and
`externalId`, which update as they change. OpenPush initializes once per page load, also under
StrictMode.

## Next.js (App Router)

The provider is a client component. Put it in the root layout:

```jsx
// app/layout.jsx
import { OpenPushProvider } from "@openpush/react";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <OpenPushProvider options={{ appId: "your-app-id" }}>{children}</OpenPushProvider>
      </body>
    </html>
  );
}
```

On the server it only renders its children.

The OpenPush prompt UI loads on demand the first time a prompt shows. To bundle it with your app
instead, add `import "@openpush/web/prompts";` once, next to where you set up OpenPush. See the
[Web SDK README](https://github.com/SuperTuned/openpush-web#readme) for where the SDK files are
served from, and for moving from another push SDK.
