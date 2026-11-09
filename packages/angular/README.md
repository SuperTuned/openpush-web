# @openpush/angular

OpenPush web push for Angular. A thin layer over `@openpush/web`.

## Install

```sh
npm install @openpush/web @openpush/angular
npx @openpush/web worker public
```

The second line writes `public/openpush-sw.js`. Serve it from your site's root (with the Angular
CLI, `public/` is copied as is).

## Standalone apps

```ts
// main.ts
import { bootstrapApplication } from "@angular/platform-browser";
import { provideOpenPush } from "@openpush/angular";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent, {
  providers: [provideOpenPush({ appId: "your-app-id" })],
});
```

## NgModule apps

```ts
import { OpenPushModule } from "@openpush/angular";

@NgModule({
  imports: [BrowserModule, OpenPushModule.forRoot({ appId: "your-app-id" })],
  bootstrap: [AppComponent],
})
export class AppModule {}
```

## Use

```ts
import { Component, inject } from "@angular/core";
import { OpenPushService } from "@openpush/angular";

@Component({
  selector: "app-subscribe",
  template: `
    @if (openpush.optedIn()) {
      <p>Notifications are on.</p>
    } @else {
      <button (click)="openpush.OpenPush.Notifications.requestPermission()">Get notifications</button>
    }
  `,
})
export class SubscribeComponent {
  readonly openpush = inject(OpenPushService);
}
```

`OpenPushService` has the `OpenPush` object and the signals `permission`, `optedIn`,
`subscriptionId` and `externalId`. OpenPush initializes once, in an environment initializer, so
route changes never initialize it again. On the server it does nothing.

The OpenPush prompt UI loads on demand the first time a prompt shows. To bundle it with your app
instead, add `import "@openpush/web/prompts";` once, next to where you set up OpenPush. See the
[Web SDK README](https://github.com/SuperTuned/openpush-web#readme) for where the SDK files are
served from, and for moving from another push SDK.
