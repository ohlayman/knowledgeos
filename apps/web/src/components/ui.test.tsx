import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from './ui.js';

function renderDrawer(onClose = vi.fn()) {
  render(
    <>
      <button type="button">页面按钮</button>
      <Drawer title="导入材料" onClose={onClose}>
        <button type="button">第一个</button>
        <button type="button">第二个</button>
      </Drawer>
    </>,
  );
  return { onClose };
}

describe('Drawer', () => {
  it('打开后焦点进入抽屉', async () => {
    renderDrawer();
    const dialog = screen.getByRole('dialog');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('按 Escape 关闭', async () => {
    const { onClose } = renderDrawer();

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab 在抽屉内循环', async () => {
    renderDrawer();
    const close = screen.getByRole('button', { name: '关闭' });
    const second = screen.getByRole('button', { name: '第二个' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    second.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(close);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(second);
  });
});
