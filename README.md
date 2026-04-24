# SCA CORPOELEC - Prototipo con Base de Datos

## Requisitos tecnicos
- XAMPP 8.x (Apache + MySQL + PHP)
- Navegador moderno

## Estructura
- `index.html`: interfaz del sistema
- `styles.css`: estilo visual
- `app.js`: logica de frontend (API + fallback local)
- `backend/schema.sql`: estructura de base de datos
- `backend/config.php`: configuracion de conexion y credenciales admin
- `backend/api.php`: API REST simple en PHP

## Configuracion en XAMPP
1. Copia esta carpeta al directorio `htdocs` de XAMPP.
2. Inicia `Apache` y `MySQL`.
3. Crea la base de datos ejecutando `backend/schema.sql` desde phpMyAdmin o consola.
   - Este script crea tablas base (`usuarios`, `departamentos`, `empleados`, `asistencias`) y un usuario admin inicial.
4. Ajusta credenciales en `backend/config.php` si tu MySQL no usa `root` sin clave.
5. Abre en navegador:
   - `http://localhost/SCA.CORPOELEC/index.html`

## Credenciales de acceso
- Usuario: `admin_cabimas`
- Clave: `123456`

## Modos de ejecucion del frontend
En `app.js`:
- `mode: 'auto'` -> usa API si corre en `http/https`, usa local si corre como `file://`
- `mode: 'api'` -> obliga uso de API
- `mode: 'local'` -> obliga uso localStorage

## Funcionalidades implementadas
- Login administrativo
- Registro, modificacion y eliminacion de empleados
- Registro de numero de carnet por empleado
- Marcacion de asistencia de empleados por carnet
- Registro de entrada de invitados por cedula
- Si un empleado marca con cedula (sin carnet), se registra como EMPLEADO con observacion de ingreso/marcaje sin carnet
- Validacion de datos en frontend y backend
- Dashboard de metricas diarias
- Dashboard con tendencia de entradas/salidas de los ultimos 7 dias
- Exportacion CSV de empleados y asistencias
- Limpieza total de empleados y asistencias

## Cambios de base de datos requeridos
Si ya tenias la base activa, vuelve a ejecutar `backend/schema.sql` para aplicar las columnas nuevas en `asistencias`:
- `medio_identificacion`
- `observacion`
