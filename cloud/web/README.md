# CRM Networking Cloud Web

Primera base web de la replica cloud. Esta version es deliberadamente solo lectura:

- lee datos importados en Supabase;
- permite validar login y aislamiento por usuario;
- muestra Dashboard, Contactos y Sistema como primera comparacion;
- no modifica contactos, interacciones, referidos, ToDos ni servicios Google.

## Configuracion local

1. Copiar `.env.example` a `.env.local`.
2. Completar:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. Instalar dependencias:

```powershell
npm install
```

4. Ejecutar:

```powershell
npm run dev
```

La app abre normalmente en `http://localhost:3000`.

Tambien puedes usar el acceso de la raiz del proyecto:

```text
abrir_app_cloud.bat
```

Ese archivo abre la app cloud sin tener que escribir comandos. La ventana debe quedar abierta mientras usas la app.

Para validar que la app compila bien, puedes usar:

```text
validar_app_cloud.bat
```

## Variables para Vercel

Agregar las mismas variables en Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

No subir claves secretas, connection strings, contrasenas ni exports con datos personales.

## Alcance v0.1

La primera meta no es reemplazar Streamlit. Es ver los datos ya importados en Supabase desde una web nueva, ordenada y lista para crecer.
