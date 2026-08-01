// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Tests for the desktop "open in your browser" bridge.
 *
 * This helper had no coverage at all, and it shipped a bug that no gate could
 * see: it returned a truthy result from every branch a desktop user could
 * reach, so the `if (!ok)` guard at both call sites was dead and a failed open
 * was completely silent. A user reported it against 11.2.0 and the code was
 * still identical in 14.x.
 *
 * The load-bearing case here is "reports failure when the native command
 * fails". The second is that no `window.open` fallback comes back: one used to
 * run after a failed invoke, and because it only ever executes inside the
 * webview - which swallows target navigation - it opened nothing and returned
 * success anyway. Deleting it was the fix, so its absence is pinned.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type TauriWindow = { __TAURI__?: unknown };

/**
 * `isTauri` is evaluated once when the module is first loaded, so each case has
 * to install its own global and then import the module fresh.
 */
async function loadDesktop(tauriGlobal?: unknown) {
  vi.resetModules();
  const w = window as unknown as TauriWindow;
  if (tauriGlobal === undefined) {
    delete w.__TAURI__;
  } else {
    w.__TAURI__ = tauriGlobal;
  }
  return import('./desktop');
}

afterEach(() => {
  delete (window as unknown as TauriWindow).__TAURI__;
  vi.restoreAllMocks();
});

describe('openAppInBrowser', () => {
  it('reports the native failure reason instead of claiming success', async () => {
    const invoke = vi.fn().mockRejectedValue('The app is still starting. Please try again in a moment.');
    const { openAppInBrowser } = await loadDesktop({ core: { invoke } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await openAppInBrowser();

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('The app is still starting. Please try again in a moment.');
  });

  it('never falls back to window.open when the native command fails', async () => {
    const invoke = vi.fn().mockRejectedValue('nope');
    const { openAppInBrowser } = await loadDesktop({ core: { invoke } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    await openAppInBrowser();

    // A webview swallows target navigation, so this fallback could only ever
    // run where it cannot work. It opened nothing and reported success, which
    // is what made the failure silent.
    expect(open).not.toHaveBeenCalled();
  });

  it('succeeds when the shell accepts the request', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const { openAppInBrowser } = await loadDesktop({ core: { invoke } });

    const result = await openAppInBrowser('/boq');

    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('open_app_in_browser', { path: '/boq' });
  });

  it('fails honestly when the bridge is missing rather than pretending', async () => {
    const { openAppInBrowser } = await loadDesktop({});

    const result = await openAppInBrowser();

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('fails outside the desktop shell', async () => {
    const { openAppInBrowser } = await loadDesktop(undefined);

    const result = await openAppInBrowser();

    expect(result.ok).toBe(false);
  });

  it('drops a path that could leave the local origin', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const { openAppInBrowser } = await loadDesktop({ core: { invoke } });

    await openAppInBrowser('//evil.example.com/');

    // Unsafe paths are ignored and the home page is opened instead, so no path
    // argument reaches the native side at all.
    expect(invoke).toHaveBeenCalledWith('open_app_in_browser', {});
  });
});
