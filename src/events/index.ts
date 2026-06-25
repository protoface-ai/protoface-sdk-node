import type { Unsubscribe } from "../types";

type Listener<T> = (payload: T) => void;

export class TypedEventEmitter<TEvents extends object> {
  private readonly listeners = new Map<keyof TEvents, Set<Listener<TEvents[keyof TEvents]>>>();

  on<TKey extends keyof TEvents>(event: TKey, listener: Listener<TEvents[TKey]>): Unsubscribe {
    const existing = this.listeners.get(event) ?? new Set<Listener<TEvents[keyof TEvents]>>();
    existing.add(listener as Listener<TEvents[keyof TEvents]>);
    this.listeners.set(event, existing);

    return () => {
      existing.delete(listener as Listener<TEvents[keyof TEvents]>);
      if (existing.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  off<TKey extends keyof TEvents>(event: TKey, listener: Listener<TEvents[TKey]>): void {
    this.listeners.get(event)?.delete(listener as Listener<TEvents[keyof TEvents]>);
  }

  emit<TKey extends keyof TEvents>(
    event: TKey,
    ...payload: undefined extends TEvents[TKey] ? [payload?: TEvents[TKey]] : [payload: TEvents[TKey]]
  ): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) {
      return;
    }
    const value = payload[0] as TEvents[keyof TEvents];
    for (const listener of [...eventListeners]) {
      listener(value);
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
