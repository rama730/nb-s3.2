'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { toast } from 'sonner';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastContextValue {
    showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
    const showToast = useCallback((message: string, type: ToastType = 'info') => {
        switch (type) {
            case 'success':
                toast.success(message);
                break;
            case 'error':
                toast.error(message);
                break;
            case 'warning':
                toast.warning(message);
                break;
            default:
                toast(message);
        }
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);

    if (!context) {
        // Fallback to sonner directly if not wrapped in provider
        return {
            showToast: (message: string, type: ToastType = 'info') => {
                switch (type) {
                    case 'success':
                        toast.success(message);
                        break;
                    case 'error':
                        toast.error(message);
                        break;
                    case 'warning':
                        toast.warning(message);
                        break;
                    default:
                        toast(message);
                }
            },
        };
    }

    return context;
}
