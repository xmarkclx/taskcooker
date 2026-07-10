import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useStableCallbackProps } from './useStableCallbackProps';

type Props = {
  count: number;
  label: string;
  onPick: (id: number) => string;
};

describe('useStableCallbackProps', () => {
  function setup(initial: Props) {
    const captured: Props[] = [];
    let update: (props: Props) => void = () => {};

    function Harness() {
      const [props, setProps] = useState(initial);
      update = (next) => setProps(next);
      captured.push(useStableCallbackProps(props));
      return null;
    }

    render(<Harness />);
    return {
      captured,
      update: (next: Props) => act(() => update(next)),
    };
  }

  it('keeps function prop identity stable across re-renders', () => {
    const { captured, update } = setup({ count: 1, label: 'a', onPick: () => 'first' });

    update({ count: 2, label: 'b', onPick: () => 'second' });

    expect(captured).toHaveLength(2);
    expect(captured[1]!.onPick).toBe(captured[0]!.onPick);
  });

  it('invokes the latest implementation with forwarded args and return value', () => {
    const first = vi.fn().mockReturnValue('first');
    const second = vi.fn().mockReturnValue('second');
    const { captured, update } = setup({ count: 1, label: 'a', onPick: first });

    update({ count: 1, label: 'a', onPick: second });

    expect(captured[0]!.onPick(42)).toBe('second');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(42);
  });

  it('passes non-function values through at their current value', () => {
    const { captured, update } = setup({ count: 1, label: 'a', onPick: () => '' });

    update({ count: 2, label: 'b', onPick: () => '' });

    expect(captured[1]!.count).toBe(2);
    expect(captured[1]!.label).toBe('b');
  });

  it('returns null while props are null and recovers stable identities after', () => {
    const captured: Array<Props | null> = [];
    let update: (props: Props | null) => void = () => {};

    function Harness() {
      const [props, setProps] = useState<Props | null>({
        count: 1,
        label: 'a',
        onPick: () => 'first',
      });
      update = (next) => setProps(next);
      captured.push(useStableCallbackProps(props));
      return null;
    }

    render(<Harness />);
    act(() => update(null));
    act(() => update({ count: 2, label: 'b', onPick: () => 'second' }));

    expect(captured[1]).toBeNull();
    expect(captured[2]!.onPick).toBe(captured[0]!.onPick);
    expect(captured[2]!.onPick(7)).toBe('second');
  });
});
