import React from 'react';
import {X, Sun, Moon, Monitor} from 'lucide-react';
import {useTheme} from './ThemeContext';

interface SettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

type PersistenceBackend = 'local' | 'cloud';

export const Settings: React.FC<SettingsProps> = ({isOpen, onClose}) => {
    const {theme, setTheme} = useTheme();
    const [backend, setBackend] = React.useState<PersistenceBackend>('local');

    React.useEffect(() => {
        // Cargar la preferencia de backend desde localStorage
        const savedBackend = localStorage.getItem('mdocs-backend') as PersistenceBackend;
        if (savedBackend) {
            setBackend(savedBackend);
        }
    }, []);

    const handleBackendChange = (newBackend: PersistenceBackend) => {
        setBackend(newBackend);
        localStorage.setItem('mdocs-backend', newBackend);
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="settings-overlay" onClick={onClose} />
            <div className="settings-modal">
                <div className="settings-header">
                    <h2>Preferencias</h2>
                    <button className="settings-close" onClick={onClose} title="Cerrar">
                        <X size={20} />
                    </button>
                </div>
                <div className="settings-content">
                    <div className="settings-section">
                        <h3>Apariencia</h3>
                        <div className="settings-option">
                            <label>Tema</label>
                            <div className="theme-options">
                                <button
                                    className={`theme-option ${theme === 'system' ? 'active' : ''}`}
                                    onClick={() => setTheme('system')}
                                >
                                    <Monitor size={18} />
                                    <span>Sistema</span>
                                </button>
                                <button
                                    className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                                    onClick={() => setTheme('light')}
                                >
                                    <Sun size={18} />
                                    <span>Claro</span>
                                </button>
                                <button
                                    className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                                    onClick={() => setTheme('dark')}
                                >
                                    <Moon size={18} />
                                    <span>Oscuro</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="settings-section">
                        <h3>Persistencia</h3>
                        <div className="settings-option">
                            <label>Backend de almacenamiento</label>
                            <div className="backend-options">
                                <button
                                    className={`backend-option ${backend === 'local' ? 'active' : ''}`}
                                    onClick={() => handleBackendChange('local')}
                                >
                                    <span>Local</span>
                                    <p>Los datos se guardan en el navegador</p>
                                </button>
                                <button
                                    className={`backend-option ${backend === 'cloud' ? 'active' : ''}`}
                                    onClick={() => handleBackendChange('cloud')}
                                >
                                    <span>Cloud</span>
                                    <p>Los datos se sincronizan en la nube</p>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};
