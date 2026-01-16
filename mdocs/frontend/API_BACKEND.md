# MDocs - Backend de Persistencia Cloud (API)

MDocs ahora soporta dos backends de persistencia:

## 1. Local (LocalStorage)

Los documentos se guardan en el navegador usando LocalStorage. Perfecto para uso personal en un solo
dispositivo.

## 2. Cloud (API Server)

Los documentos se guardan en el filesystem del servidor a través de una API REST.

### Estructura del servidor

El servidor API guarda los archivos en `/tmp/mdocs/userpath/` con la siguiente estructura:

```
/tmp/mdocs/userpath/
├── .index.json          # Índice de todos los archivos y directorios
├── document1.md
├── folder1/
│   ├── document2.md
│   └── subfolder/
│       └── document3.md
└── document4.txt
```

### Iniciar el servidor

```bash
cd server
npm install
npm start
```

El servidor se iniciará en `http://localhost:3001`

### API Endpoints

- `GET /api/files` - Obtener todos los archivos
- `GET /api/files/:id` - Obtener un archivo específico
- `POST /api/files` - Crear un nuevo archivo/directorio
- `PUT /api/files/:id` - Actualizar un archivo
- `DELETE /api/files/:id` - Eliminar un archivo

### Cambiar entre backends

1. Haz clic en el icono de configuración (⚙️)
2. Selecciona el backend deseado:
    - **Local**: Los datos se guardan en el navegador
    - **Cloud**: Los datos se guardan en el servidor (requiere que el servidor esté corriendo)
3. La aplicación se recargará automáticamente

### Notas importantes

- **UserPath**: Por ahora, todos los documentos se guardan en `/tmp/mdocs/userpath/`. En el futuro se
  implementará soporte multi-usuario.
- **Persistencia**: `/tmp` es temporal en Linux. Para producción, cambia `BASE_PATH` en `server/server.js` a
  una ubicación permanente.
- **Seguridad**: El servidor actual no tiene autenticación. Es solo para desarrollo/uso personal.

### Próximas mejoras

- [ ] Autenticación de usuarios
- [ ] Múltiples users paths
- [ ] Sincronización en tiempo real
- [ ] Historial de versiones
- [ ] Compartir documentos
