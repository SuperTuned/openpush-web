import { signal, type Signal } from "@angular/core";
import OpenPush, { setSdkWrapper, VERSION, type InitOptions, type OpenPushApi } from "@openpush/web";

let started: Promise<void> | undefined;

/**
 * The `OpenPush` object and its state as signals. Provided by `provideOpenPush()` or
 * `OpenPushModule.forRoot()`; inject it with `inject(OpenPushService)`.
 */
export class OpenPushService {
  /** The SDK object; every OpenPush call is on it. */
  readonly OpenPush: OpenPushApi = OpenPush;
  private readonly permissionState = signal(false);
  private readonly optedInState = signal(false);
  private readonly subscriptionIdState = signal<string | null>(null);
  private readonly externalIdState = signal<string | null>(null);
  /** Browser permission granted. */
  readonly permission: Signal<boolean> = this.permissionState.asReadonly();
  /** Permission granted, a browser subscription, and no opt-out. */
  readonly optedIn: Signal<boolean> = this.optedInState.asReadonly();
  readonly subscriptionId: Signal<string | null> = this.subscriptionIdState.asReadonly();
  readonly externalId: Signal<string | null> = this.externalIdState.asReadonly();

  /** Called once by the environment initializer; route changes never call it again. Browser only. */
  start(options: InitOptions): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    const update = (): void => this.update();
    OpenPush.PushSubscription.addObserver(update);
    OpenPush.Notifications.addPermissionObserver(update);
    OpenPush.User.addObserver(update);
    if (!started) {
      setSdkWrapper(`angular/${VERSION}`);
      started = OpenPush.initialize(options);
    }
    return started.then(update, (error: unknown) => {
      console.error(`[OpenPush] initialize failed: ${error instanceof Error ? error.message : String(error)}`);
      update();
    });
  }

  private update(): void {
    this.permissionState.set(OpenPush.Notifications.permission);
    this.optedInState.set(OpenPush.PushSubscription.optedIn);
    this.subscriptionIdState.set(OpenPush.PushSubscription.id);
    this.externalIdState.set(OpenPush.User.externalId);
  }
}
