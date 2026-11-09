import { inject, InjectionToken, makeEnvironmentProviders, provideEnvironmentInitializer, type EnvironmentProviders } from "@angular/core";
import type { InitOptions } from "@openpush/web";
import { OpenPushService } from "./service";

export const OPENPUSH_OPTIONS = new InjectionToken<InitOptions>("OpenPush options");

/**
 * For standalone apps: `bootstrapApplication(App, { providers: [provideOpenPush({ appId })] })`.
 * OpenPush initializes once, in an environment initializer, so route changes never initialize it again.
 */
export function provideOpenPush(options: InitOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: OPENPUSH_OPTIONS, useValue: options },
    { provide: OpenPushService, useFactory: () => new OpenPushService() },
    provideEnvironmentInitializer(() => {
      void inject(OpenPushService).start(inject(OPENPUSH_OPTIONS));
    }),
  ]);
}
