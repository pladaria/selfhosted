# Configuración de Supabase para MDocs

Este documento explica cómo configurar Supabase para usar el almacenamiento en la nube con MDocs.

## 1. Crear una cuenta en Supabase

1. Ve a [supabase.com](https://supabase.com)
2. Crea una cuenta o inicia sesión
3. Crea un nuevo proyecto

## 2. Crear la tabla `files`

En el panel de Supabase, ve a la sección SQL Editor y ejecuta el siguiente script:

```sql
-- Crear la tabla files
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT,
  parent_id TEXT,
  user_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Crear índices para mejorar el rendimiento
CREATE INDEX idx_files_user_id ON files(user_id);
CREATE INDEX idx_files_parent_id ON files(parent_id);
CREATE INDEX idx_files_user_parent ON files(user_id, parent_id);
```

**IMPORTANTE:** Por defecto, RLS está deshabilitado. Esto está bien para uso personal.

Si quieres habilitar seguridad adicional más adelante, ejecuta:

```sql
-- Habilitar Row Level Security
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- Política que permite acceso completo (para empezar)
CREATE POLICY "Enable all access for all users"
  ON files FOR ALL
  USING (true)
  WITH CHECK (true);
```

```sql
ALTER TABLE files DISABLE ROW LEVEL SECURITY;
```

## 3. Obtener las credenciales

1. En el panel de Supabase, ve a **Settings** > **API**
2. Copia la **Project URL** (ej: `https://xxxxx.supabase.co`)
3. Copia la **anon/public key**

## 4. Configurar MDocs

1. Abre MDocs y haz clic en el icono de configuración (⚙️)
2. Selecciona **Cloud** como backend de persistencia
3. Introduce tus credenciales:
    - **URL del Proyecto**: La URL que copiaste
    - **Anon Key**: La clave pública
    - **User ID**: Un identificador único para tus documentos (puede ser cualquier string, ej: tu email)

## 5. ¡Listo!

Ahora tus documentos se guardarán automáticamente en Supabase y estarán disponibles desde cualquier
dispositivo.

## Migrar datos de Local a Cloud

Si ya tienes documentos guardados localmente y quieres migrarlos a Supabase:

1. Exporta tus datos del localStorage (desde la consola del navegador):

```javascript
const data = localStorage.getItem('mdocs-filesystem');
console.log(data);
```

2. Copia el JSON resultante
3. Cambia a modo Cloud en MDocs
4. Importa los documentos manualmente o usa el siguiente script en la consola:

```javascript
// Suponiendo que ya tienes configurado Supabase
const localData = JSON.parse(localStorage.getItem('mdocs-filesystem'));
// Luego crea los documentos uno por uno a través de la UI
```

## Solución de problemas

### Error 401 o "violates row-level security policy"

Supabase tiene activado RLS (Row Level Security) en tu tabla. Para solucionarlo:

1. Ve al SQL Editor en Supabase
2. Ejecuta este comando:

```sql
ALTER TABLE files DISABLE ROW LEVEL SECURITY;
```

O si prefieres mantener RLS activo, usa políticas permisivas:

```sql
-- Eliminar políticas antiguas si existen
DROP POLICY IF EXISTS "Users can view their own files" ON files;
DROP POLICY IF EXISTS "Users can insert their own files" ON files;
DROP POLICY IF EXISTS "Users can update their own files" ON files;
DROP POLICY IF EXISTS "Users can delete their own files" ON files;

-- Crear política permisiva
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all access for all users"
  ON files FOR ALL
  USING (true)
  WITH CHECK (true);
```

### Error al cargar los documentos

- Verifica que las credenciales sean correctas
- Asegúrate de que la tabla `files` existe
- Revisa la consola del navegador para ver errores específicos

### Los documentos no se sincronizan

- Verifica que el `user_id` sea el mismo en todos los dispositivos
- Asegúrate de tener conexión a internet
- Revisa las políticas de RLS si las activaste

## Seguridad

Para mayor seguridad en producción:

1. **Activa RLS** (Row Level Security)
2. **Usa autenticación de Supabase**: Implementa auth y usa el `user.id` real en lugar de un string fijo
3. **Configura políticas apropiadas**: Asegúrate de que cada usuario solo pueda ver sus propios documentos
