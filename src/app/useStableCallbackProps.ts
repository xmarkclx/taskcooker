import { useInsertionEffect, useRef } from 'react';

type AnyFunction = (...args: never[]) => unknown;

/**
 * Returns the same props with every function prop replaced by a
 * referentially-stable wrapper that always calls the latest implementation.
 * Non-function props pass through untouched, so a `memo`-wrapped child
 * re-renders only when its data props actually change instead of on every
 * parent render that rebuilds inline callbacks.
 *
 * The wrappers read the current props from a ref at call time, so they never
 * capture stale closures — the same contract as React's useEffectEvent.
 * Because of that, the wrappers must not be called during render.
 */
export function useStableCallbackProps<T extends object>(props: T): T;
export function useStableCallbackProps<T extends object>(props: T | null): T | null;
export function useStableCallbackProps<T extends object>(props: T | null): T | null {
  const latestRef = useRef(props);
  useInsertionEffect(() => {
    if (props !== null) {
      latestRef.current = props;
    }
  });
  const wrappersRef = useRef(new Map<PropertyKey, AnyFunction>());

  if (props === null) {
    return null;
  }

  const result = {} as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(props)) {
    const value = (props as Record<PropertyKey, unknown>)[key];
    if (typeof value !== 'function') {
      result[key] = value;
      continue;
    }

    let wrapper = wrappersRef.current.get(key);
    if (!wrapper) {
      wrapper = (...args: never[]) => {
        const latest = (latestRef.current as Record<PropertyKey, unknown> | null)?.[key];
        return typeof latest === 'function' ? (latest as AnyFunction)(...args) : undefined;
      };
      wrappersRef.current.set(key, wrapper);
    }
    result[key] = wrapper;
  }
  return result as T;
}
