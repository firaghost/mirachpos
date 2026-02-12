import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/ui/app-icon', () => ({
  AppIcon: () => <span data-testid="app-icon" />,
}));

import { Modal } from './Modal';

describe('Modal', () => {
  it('does not render when closed', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open={false} title="T" onClose={onClose}>
        <div>Body</div>
      </Modal>,
    );

    expect(container.textContent).toBe('');
  });

  it('renders when open and closes on backdrop click and Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Title" onClose={onClose} footer={<div>Footer</div>}>
        <div>Body</div>
      </Modal>,
    );

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();

    const backdrop = document.querySelector('div.absolute.inset-0') as HTMLDivElement | null;
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders without footer when footer prop is omitted', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Title" onClose={onClose}>
        <div>Body</div>
      </Modal>,
    );

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.queryByText('Footer')).toBeNull();
  });
});
