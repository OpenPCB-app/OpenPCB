import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './auth-store';

describe('useAuthStore', () => {
    beforeEach(() => {
        useAuthStore.getState().reset();
    });

    it('should have initial pending state', () => {
        const state = useAuthStore.getState();
        expect(state.status).toBe('pending');
        expect(state.isLicensed).toBe(false);
        expect(state.error).toBe(null);
    });

    it('should update status', () => {
        useAuthStore.getState().setStatus('loading');
        expect(useAuthStore.getState().status).toBe('loading');

        useAuthStore.getState().setStatus('ready');
        expect(useAuthStore.getState().status).toBe('ready');

        useAuthStore.getState().setStatus('blocked');
        expect(useAuthStore.getState().status).toBe('blocked');
    });

    it('should update licensed status', () => {
        useAuthStore.getState().setLicensed(true);
        expect(useAuthStore.getState().isLicensed).toBe(true);
    });

    it('should update error', () => {
        const errorMsg = 'License expired';
        useAuthStore.getState().setError(errorMsg);
        expect(useAuthStore.getState().error).toBe(errorMsg);
    });

    it('should reset state', () => {
        useAuthStore.getState().setStatus('ready');
        useAuthStore.getState().setLicensed(true);
        useAuthStore.getState().setError('some error');

        useAuthStore.getState().reset();

        const state = useAuthStore.getState();
        expect(state.status).toBe('pending');
        expect(state.isLicensed).toBe(false);
        expect(state.error).toBe(null);
    });
});
