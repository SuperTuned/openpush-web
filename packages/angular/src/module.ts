import { NgModule, type ModuleWithProviders } from "@angular/core";
import type { InitOptions } from "@openpush/web";
import { provideOpenPush } from "./providers";

/** For NgModule apps: `imports: [OpenPushModule.forRoot({ appId })]` in the root module. */
@NgModule({})
export class OpenPushModule {
  static forRoot(options: InitOptions): ModuleWithProviders<OpenPushModule> {
    return { ngModule: OpenPushModule, providers: [provideOpenPush(options)] };
  }
}
