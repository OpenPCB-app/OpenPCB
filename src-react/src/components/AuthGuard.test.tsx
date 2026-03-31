import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthGuard } from './AuthGuard';
import { useAuthStore } from '@/stores/auth-store';

describe('AuthGuard', () => {
    beforeEach(() => {
        useAuthStore.getState().reset();
    });

    it('renders loading state when pending', () => {
        useAuthStore.getState().setStatus('pending');
        render(<AuthGuard><div>Content</div></AuthGuard>);
        expect(screen.getByTestId('auth-loading')).toBeDefined();
        expect(screen.queryByText('Content')).toBeNull();
    });

    it('renders loading state when loading', () => {
        useAuthStore.getState().setStatus('loading');
        render(<AuthGuard><div>Content</div></AuthGuard>);
        expect(screen.getByTestId('auth-loading')).toBeDefined();
    });

    it('renders blocked state when blocked', () => {
        const errorMsg = 'License expired';
        useAuthStore.getState().setStatus('blocked');
        useAuthStore.getState().setError(errorMsg);
        render(<AuthGuard><div>Content</div></AuthGuard>);
        expect(screen.getByTestId('auth-blocked')).toBeDefined();
        expect(screen.getByText(errorMsg)).toBeDefined();
        expect(screen.queryByText('Content')).toBeNull();
    });

    it('renders children when ready', () => {
        useAuthStore.getState().setStatus('ready');
        render(<AuthGuard><div>Content</div></AuthGuard>);
        expect(screen.queryByTestId('auth-loading')).toBeNull();
        expect(screen.queryByTestId('auth-blocked')).toBeNull();
        expect(screen.getByText('Content')).toBeDefined();
    });
});
