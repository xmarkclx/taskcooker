import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { DeferredMount, useActivatedOnce } from './DeferredMount';

describe('DeferredMount', () => {
  it('shows the fallback first and mounts children after the shell can paint', async () => {
    render(
      <DeferredMount fallback={<span>island loading</span>}>
        <span>island content</span>
      </DeferredMount>,
    );

    expect(screen.getByText('island loading')).toBeInTheDocument();
    expect(screen.queryByText('island content')).not.toBeInTheDocument();

    expect(await screen.findByText('island content')).toBeInTheDocument();
    expect(screen.queryByText('island loading')).not.toBeInTheDocument();
  });

  it('shows an accessible spinner when no fallback is given', () => {
    render(
      <DeferredMount>
        <span>island content</span>
      </DeferredMount>,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('can wait for an idle slot after the shell paints before mounting children', () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const idleCallbacks: IdleRequestCallback[] = [];
    const originalRequestIdleCallback = window.requestIdleCallback;
    const originalCancelIdleCallback = window.cancelIdleCallback;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: vi.fn((callback: IdleRequestCallback) => {
        idleCallbacks.push(callback);
        return idleCallbacks.length;
      }),
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: vi.fn(),
    });

    try {
      render(
        <DeferredMount fallback={<span>terminal loading</span>} strategy="idle">
          <span>terminal content</span>
        </DeferredMount>,
      );

      expect(screen.getByText('terminal loading')).toBeInTheDocument();
      expect(screen.queryByText('terminal content')).not.toBeInTheDocument();

      act(() => {
        frameCallbacks.shift()?.(performance.now());
        frameCallbacks.shift()?.(performance.now());
      });

      expect(screen.getByText('terminal loading')).toBeInTheDocument();
      expect(screen.queryByText('terminal content')).not.toBeInTheDocument();

      act(() => {
        idleCallbacks.shift()?.({
          didTimeout: false,
          timeRemaining: () => 20,
        });
      });

      expect(screen.getByText('terminal content')).toBeInTheDocument();
      expect(screen.queryByText('terminal loading')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      if (originalRequestIdleCallback) {
        Object.defineProperty(window, 'requestIdleCallback', {
          configurable: true,
          value: originalRequestIdleCallback,
        });
      }
      if (originalCancelIdleCallback) {
        Object.defineProperty(window, 'cancelIdleCallback', {
          configurable: true,
          value: originalCancelIdleCallback,
        });
      }
    }
  });
});

function ActivationProbe({ active }: { active: boolean }) {
  const activated = useActivatedOnce(active);
  return <span>{activated ? 'activated' : 'idle'}</span>;
}

function ActivationToggle() {
  const [active, setActive] = useState(false);
  return (
    <>
      <button onClick={() => setActive((current) => !current)} type="button">
        toggle
      </button>
      <ActivationProbe active={active} />
    </>
  );
}

describe('useActivatedOnce', () => {
  it('stays activated after the first active render so islands never unmount', () => {
    render(<ActivationToggle />);

    expect(screen.getByText('idle')).toBeInTheDocument();

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByText('activated')).toBeInTheDocument();

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByText('activated')).toBeInTheDocument();
  });
});
