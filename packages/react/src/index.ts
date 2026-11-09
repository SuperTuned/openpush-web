"use client";
/**
 * `@openpush/react`: `<OpenPushProvider options>` initializes OpenPush once per page load and
 * `useOpenPush()` gives the `OpenPush` object with reactive `permission`, `optedIn`,
 * `subscriptionId` and `externalId`.
 *
 * Next.js App Router: this file is a client module; on the server the provider only renders its
 * children (effects never run there).
 */
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import OpenPush, { setSdkWrapper, VERSION, type InitOptions, type OpenPushApi } from "@openpush/web";

export interface OpenPushState {
  /** The SDK object; every OpenPush call is on it. */
  OpenPush: OpenPushApi;
  /** Browser permission granted. */
  permission: boolean;
  /** Permission granted, a browser subscription, and no opt-out. */
  optedIn: boolean;
  subscriptionId: string | null;
  externalId: string | null;
}

export interface OpenPushProviderProps {
  options: InitOptions;
  children?: ReactNode;
}

const SERVER_STATE: OpenPushState = { OpenPush, permission: false, optedIn: false, subscriptionId: null, externalId: null };

const Context = createContext<OpenPushState>(SERVER_STATE);

/** One `initialize` per page load, also under StrictMode's double effects and remounts. */
let started: Promise<void> | undefined;

export function initOnce(options: InitOptions): Promise<void> {
  if (!started) {
    setSdkWrapper(`react/${VERSION}`);
    started = OpenPush.initialize(options);
  }
  return started;
}

function read(): OpenPushState {
  return {
    OpenPush,
    permission: OpenPush.Notifications.permission,
    optedIn: OpenPush.PushSubscription.optedIn,
    subscriptionId: OpenPush.PushSubscription.id,
    externalId: OpenPush.User.externalId,
  };
}

function same(a: OpenPushState, b: OpenPushState): boolean {
  return a.permission === b.permission && a.optedIn === b.optedIn && a.subscriptionId === b.subscriptionId && a.externalId === b.externalId;
}

export function OpenPushProvider({ options, children }: OpenPushProviderProps) {
  const [state, setState] = useState<OpenPushState>(SERVER_STATE);
  useEffect(() => {
    let live = true;
    const update = (): void => {
      if (!live) return;
      const next = read();
      setState((current) => (same(current, next) ? current : next));
    };
    OpenPush.PushSubscription.addObserver(update);
    OpenPush.Notifications.addPermissionObserver(update);
    OpenPush.User.addObserver(update);
    initOnce(options).then(update, (error: unknown) => {
      console.error(`[OpenPush] initialize failed: ${error instanceof Error ? error.message : String(error)}`);
      update();
    });
    return () => {
      live = false;
      OpenPush.PushSubscription.removeObserver(update);
      OpenPush.Notifications.removePermissionObserver(update);
      OpenPush.User.removeObserver(update);
    };
    // Options are read once: OpenPush initializes once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createElement(Context.Provider, { value: state }, children);
}

/** The `OpenPush` object and its reactive state. Outside a provider the state stays at its defaults. */
export function useOpenPush(): OpenPushState {
  return useContext(Context);
}

export type { InitOptions, OpenPushApi };
