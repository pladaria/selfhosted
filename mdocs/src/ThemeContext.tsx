import React, {createContext, useContext, useState, useEffect, ReactNode} from 'react';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
    theme: Theme;
    resolvedTheme: ResolvedTheme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within ThemeProvider');
    }
    return context;
};

interface ThemeProviderProps {
    children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({children}) => {
    const [theme, setThemeState] = useState<Theme>(() => {
        const saved = localStorage.getItem('mdocs-theme');
        return (saved as Theme) || 'system';
    });

    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('dark');

    const getSystemTheme = (): ResolvedTheme => {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem('mdocs-theme', newTheme);
    };

    useEffect(() => {
        const updateResolvedTheme = () => {
            const resolved = theme === 'system' ? getSystemTheme() : theme;
            setResolvedTheme(resolved);
            document.documentElement.setAttribute('data-theme', resolved);
        };

        updateResolvedTheme();

        if (theme === 'system') {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const handler = () => updateResolvedTheme();
            mediaQuery.addEventListener('change', handler);
            return () => mediaQuery.removeEventListener('change', handler);
        }
    }, [theme]);

    return <ThemeContext.Provider value={{theme, resolvedTheme, setTheme}}>{children}</ThemeContext.Provider>;
};
