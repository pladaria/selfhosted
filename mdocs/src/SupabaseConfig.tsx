import React, {useState, useEffect} from 'react';
import {X, Cloud} from 'lucide-react';

interface SupabaseConfigProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (url: string, key: string, userId: string) => void;
}

export const SupabaseConfig: React.FC<SupabaseConfigProps> = ({isOpen, onClose, onSave}) => {
    const [url, setUrl] = useState('');
    const [key, setKey] = useState('');
    const [userId, setUserId] = useState('');

    useEffect(() => {
        if (isOpen) {
            // Cargar configuración guardada
            const savedUrl = localStorage.getItem('supabase-url') || '';
            const savedKey = localStorage.getItem('supabase-key') || '';
            const savedUserId = localStorage.getItem('supabase-user-id') || '';
            setUrl(savedUrl);
            setKey(savedKey);
            setUserId(savedUserId);
        }
    }, [isOpen]);

    const handleSave = () => {
        if (!url || !key || !userId) {
            alert('Por favor completa todos los campos');
            return;
        }

        localStorage.setItem('supabase-url', url);
        localStorage.setItem('supabase-key', key);
        localStorage.setItem('supabase-user-id', userId);

        onSave(url, key, userId);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="settings-overlay" onClick={onClose} />
            <div className="settings-modal">
                <div className="settings-header">
                    <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
                        <Cloud size={24} />
                        <h2>Configuración de Supabase</h2>
                    </div>
                    <button className="settings-close" onClick={onClose} title="Cerrar">
                        <X size={20} />
                    </button>
                </div>
                <div className="settings-content">
                    <div className="settings-section">
                        <p style={{color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.6'}}>
                            Para usar el almacenamiento en la nube, necesitas configurar tu proyecto de
                            Supabase. Puedes encontrar estos datos en la configuración de tu proyecto en{' '}
                            <a
                                href="https://supabase.com/dashboard"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{color: 'var(--accent)'}}
                            >
                                supabase.com/dashboard
                            </a>
                        </p>

                        <div className="settings-option">
                            <label htmlFor="supabase-url">URL del Proyecto</label>
                            <input
                                id="supabase-url"
                                type="url"
                                className="settings-input"
                                placeholder="https://xxxxx.supabase.co"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                            />
                        </div>

                        <div className="settings-option">
                            <label htmlFor="supabase-key">Anon Key</label>
                            <input
                                id="supabase-key"
                                type="password"
                                className="settings-input"
                                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                                value={key}
                                onChange={(e) => setKey(e.target.value)}
                            />
                        </div>

                        <div className="settings-option">
                            <label htmlFor="user-id">User ID</label>
                            <input
                                id="user-id"
                                type="text"
                                className="settings-input"
                                placeholder="tu-user-id-unico"
                                value={userId}
                                onChange={(e) => setUserId(e.target.value)}
                            />
                            <small
                                style={{color: 'var(--text-secondary)', fontSize: '12px', marginTop: '4px'}}
                            >
                                Un identificador único para tus documentos
                            </small>
                        </div>

                        <div
                            className="info-box"
                            style={{
                                backgroundColor: 'var(--bg-tertiary)',
                                padding: '16px',
                                borderRadius: '6px',
                                marginTop: '24px',
                            }}
                        >
                            <strong
                                style={{color: 'var(--text-heading)', display: 'block', marginBottom: '8px'}}
                            >
                                Tabla requerida en Supabase:
                            </strong>
                            <pre
                                style={{
                                    backgroundColor: 'var(--bg-primary)',
                                    padding: '12px',
                                    borderRadius: '4px',
                                    overflow: 'auto',
                                    fontSize: '12px',
                                }}
                            >
                                {`CREATE TABLE files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT,
  parent_id TEXT,
  user_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_files_user_id ON files(user_id);
CREATE INDEX idx_files_parent_id ON files(parent_id);`}
                            </pre>
                            <small
                                style={{
                                    color: 'var(--text-secondary)',
                                    fontSize: '11px',
                                    display: 'block',
                                    marginTop: '8px',
                                }}
                            >
                                Por defecto RLS está deshabilitado. Perfecto para uso personal.
                            </small>
                        </div>

                        <div style={{display: 'flex', gap: '8px', marginTop: '24px'}}>
                            <button
                                onClick={handleSave}
                                style={{
                                    flex: 1,
                                    backgroundColor: 'var(--accent)',
                                    color: 'white',
                                    border: 'none',
                                    padding: '10px 16px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontWeight: 500,
                                }}
                            >
                                Guardar Configuración
                            </button>
                            <button
                                onClick={onClose}
                                style={{
                                    backgroundColor: 'var(--bg-tertiary)',
                                    color: 'var(--text-primary)',
                                    border: '1px solid var(--border-color)',
                                    padding: '10px 16px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                }}
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};
