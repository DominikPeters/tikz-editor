import { afterEach, describe, expect, it, vi } from "vitest";
import { bindPresentationFocus } from "../packages/app/src/presentation/focus.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail; });
  return { promise, resolve, reject };
}

describe("presentation focus registration", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("reports a rejected native subscription without an unhandled rejection", async () => {
    const error = new Error("Native focus registration unavailable");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const dispose = bindPresentationFocus({ onFocus: () => Promise.reject(error) }, vi.fn());
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining("focus tracking"), error));
    dispose();
  });

  it("handles synchronous registration errors too", async () => {
    const error = new Error("Native window is unavailable");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const dispose = bindPresentationFocus({ onFocus: () => { throw error; } }, vi.fn());
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining("focus tracking"), error));
    dispose();
  });

  it("releases a late subscription and ignores events after disposal", async () => {
    const registration = deferred<() => void>();
    const receive = vi.fn(), unbind = vi.fn();
    let emit!: () => void;
    const onFocus = vi.fn((handler: () => void) => { emit = handler; return registration.promise; });
    const dispose = bindPresentationFocus({ onFocus }, receive);
    await vi.waitFor(() => expect(onFocus).toHaveBeenCalledOnce());
    emit();
    expect(receive).toHaveBeenCalledOnce();
    dispose();
    emit();
    expect(receive).toHaveBeenCalledOnce();
    registration.resolve(unbind);
    await vi.waitFor(() => expect(unbind).toHaveBeenCalledOnce());
    dispose();
    expect(unbind).toHaveBeenCalledOnce();
  });

  it("unbinds an installed subscription once and suppresses stale callbacks", async () => {
    const receive = vi.fn(), unbind = vi.fn();
    let emit!: () => void;
    const onFocus = vi.fn((handler: () => void) => { emit = handler; return Promise.resolve(unbind); });
    const dispose = bindPresentationFocus({ onFocus }, receive);
    await vi.waitFor(() => expect(onFocus).toHaveBeenCalledOnce());
    emit();
    expect(receive).toHaveBeenCalledOnce();
    dispose();
    dispose();
    expect(unbind).toHaveBeenCalledOnce();
    emit();
    expect(receive).toHaveBeenCalledOnce();
  });

  it("does not begin registration after immediate disposal", async () => {
    const onFocus = vi.fn(() => Promise.resolve(vi.fn()));
    const dispose = bindPresentationFocus({ onFocus }, vi.fn());
    dispose();
    await Promise.resolve();
    expect(onFocus).not.toHaveBeenCalled();
    bindPresentationFocus(undefined, vi.fn())();
    bindPresentationFocus({}, vi.fn())();
  });

  it("handles asynchronous native cleanup failures", async () => {
    const error = new Error("Native window closed during cleanup");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const unbind = vi.fn(async () => { throw error; });
    const onFocus = vi.fn(() => Promise.resolve(unbind));
    const dispose = bindPresentationFocus({ onFocus }, vi.fn());
    await vi.waitFor(() => expect(onFocus).toHaveBeenCalledOnce());
    dispose();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining("release"), error));
    expect(unbind).toHaveBeenCalledOnce();
  });
});
