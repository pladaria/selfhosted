import React from 'react';
import {Sun, Moon, Monitor} from 'lucide-react';
import {useTheme} from './ThemeContext';

export const ThemeSelector: React.FC = () => {
    const {theme, setTheme} = useTheme();

    const cycleTheme = () => {
        const themes: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark'];
        const currentIndex = themes.indexOf(theme);
        const nextIndex = (currentIndex + 1) % themes.length;
        setTheme(themes[nextIndex]);
    };

    const getIcon = () => {
        switch (theme) {
            case 'light':
                return <Sun size={16} />;
            case 'dark':
                return <Moon size={16} />;
            case 'system':
                return <Monitor size={16} />;
        }
    };

    const getTitle = () => {
        switch (theme) {
            case 'light':
                return 'Tema claro';
            case 'dark':
                return 'Tema oscuro';
            case 'system':
                return 'Tema del sistema';
        }
    };

    return (
        <button className="theme-selector" onClick={cycleTheme} title={getTitle()}>
            {getIcon()}
        </button>
    );
};
