<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/db.php';

$config = require __DIR__ . '/config.php';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';

try {
    $pdo = db_connection();
    ensure_schema($pdo);
    archive_expired_attendance($pdo);

    if ($method === 'GET' && $action === 'bootstrap') {
        json_response(200, [
            'ok' => true,
            'data' => get_bootstrap_data($pdo)
        ]);
    }

    if ($method === 'POST' && $action === 'login') {
        $payload = get_json_input();
        validate_required($payload, ['user', 'pass']);

        $user = normalize_text((string) $payload['user']);
        $pass = (string) $payload['pass'];

        $stmt = $pdo->prepare('SELECT usuario, clave FROM usuarios WHERE usuario = :usuario LIMIT 1');
        $stmt->execute([':usuario' => $user]);
        $dbUser = $stmt->fetch();

        $ok = false;

        if ($dbUser) {
            $ok = hash_equals((string) $dbUser['clave'], $pass);
        } else {
            $ok = $user === $config['auth']['username']
                && $pass === $config['auth']['password'];
        }

        if (!$ok) {
            json_response(401, [
                'ok' => false,
                'message' => 'Credenciales invalidas.'
            ]);
        }

        json_response(200, [
            'ok' => true,
            'message' => 'Acceso correcto.'
        ]);
    }

    if ($method === 'POST' && $action === 'archive_sync') {
        json_response(200, [
            'ok' => true,
            'message' => 'Archivo sincronizado correctamente.',
            'data' => get_bootstrap_data($pdo)
        ]);
    }

    if ($method === 'POST' && $action === 'employee_create') {
        $payload = get_json_input();
        validate_required($payload, ['nombre', 'cedula', 'carnet', 'departamento', 'cargo']);
        validate_employee_payload($payload);

        $sql = 'INSERT INTO empleados (cedula, carnet, nombre, departamento, cargo) VALUES (:cedula, :carnet, :nombre, :departamento, :cargo)';
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':cedula' => normalize_text($payload['cedula']),
            ':carnet' => normalize_text($payload['carnet']),
            ':nombre' => normalize_text($payload['nombre']),
            ':departamento' => normalize_text($payload['departamento']),
            ':cargo' => normalize_text($payload['cargo'])
        ]);

        json_response(201, [
            'ok' => true,
            'data' => get_bootstrap_data($pdo)
        ]);
    }

    if ($method === 'POST' && $action === 'employee_update') {
        $payload = get_json_input();
        validate_required($payload, ['original_cedula', 'nombre', 'cedula', 'carnet', 'departamento', 'cargo']);
        validate_employee_payload($payload);

        $originalCedula = normalize_text($payload['original_cedula']);

        $existsStmt = $pdo->prepare('SELECT id FROM empleados WHERE cedula = :cedula LIMIT 1');
        $existsStmt->execute([':cedula' => $originalCedula]);

        if (!$existsStmt->fetch()) {
            json_response(404, [
                'ok' => false,
                'message' => 'No se encontro el empleado a modificar.'
            ]);
        }

        $sql = 'UPDATE empleados SET cedula = :cedula, carnet = :carnet, nombre = :nombre, departamento = :departamento, cargo = :cargo WHERE cedula = :original_cedula';
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':cedula' => normalize_text($payload['cedula']),
            ':carnet' => normalize_text($payload['carnet']),
            ':nombre' => normalize_text($payload['nombre']),
            ':departamento' => normalize_text($payload['departamento']),
            ':cargo' => normalize_text($payload['cargo']),
            ':original_cedula' => $originalCedula
        ]);

        json_response(200, [
            'ok' => true,
            'data' => get_bootstrap_data($pdo)
        ]);
    }

    if ($method === 'POST' && $action === 'employee_delete') {
        $payload = get_json_input();
        validate_required($payload, ['cedula']);

        $stmt = $pdo->prepare('DELETE FROM empleados WHERE cedula = :cedula');
        $stmt->execute([':cedula' => normalize_text($payload['cedula'])]);

        json_response(200, [
            'ok' => true,
            'data' => get_bootstrap_data($pdo)
        ]);
    }

    if ($method === 'POST' && $action === 'employees_clear') {
        $pdo->beginTransaction();
        $pdo->exec('DELETE FROM asistencias');
        $pdo->exec('DELETE FROM empleados');
        $pdo->commit();

        json_response(200, [
            'ok' => true,
            'data' => get_bootstrap_data($pdo)
        ]);
    }

    if ($method === 'POST' && $action === 'attendance_mark') {
        $payload = get_json_input();
        validate_required($payload, ['identificador', 'tipo']);

        $identificador = strtoupper(normalize_text($payload['identificador']));
        validate_identifier($identificador);
        $tipo = strtoupper(normalize_text($payload['tipo']));
        $observacionManual = trim((string) ($payload['observacion'] ?? ''));
        $departamentoBuscado = trim((string) ($payload['departamento_buscado'] ?? ''));
        $personaBuscada = trim((string) ($payload['persona_buscada'] ?? ''));
        validate_observacion($observacionManual);
        validate_guest_context($departamentoBuscado, $personaBuscada);

        if (!in_array($tipo, ['ENTRADA', 'SALIDA'], true)) {
            json_response(422, [
                'ok' => false,
                'message' => 'Tipo de marcacion invalido.'
            ]);
        }

        $stmtCarnet = $pdo->prepare('SELECT cedula, carnet, nombre FROM empleados WHERE carnet = :identificador LIMIT 1');
        $stmtCarnet->execute([':identificador' => $identificador]);
        $empleadoPorCarnet = $stmtCarnet->fetch();

        $stmtCedula = $pdo->prepare('SELECT cedula, carnet, nombre FROM empleados WHERE UPPER(cedula) = :identificador LIMIT 1');
        $stmtCedula->execute([':identificador' => $identificador]);
        $empleadoPorCedula = $stmtCedula->fetch();

        $empleado = $empleadoPorCarnet ?: $empleadoPorCedula;

        $fecha = date('Y-m-d');
        $hora = date('H:i:s');

        if ($empleado) {
            $ultimoMarcaje = get_last_attendance_for_employee($pdo, (string) $empleado['cedula']);
            enforce_alternating_mark($ultimoMarcaje, $tipo, 'empleado');

            $medio = $empleadoPorCarnet ? 'CARNET' : 'CEDULA';
            $observacionBase = $medio === 'CEDULA'
                ? ($tipo === 'ENTRADA' ? 'Ingreso sin carnet' : 'Salida sin carnet')
                : '';
            $observacion = compose_observacion($observacionBase, $observacionManual);

            $insert = $pdo->prepare('INSERT INTO asistencias (cedula, carnet, tipo_registro, cedula_invitado, medio_identificacion, observacion, departamento_buscado, persona_buscada, tipo, fecha, hora) VALUES (:cedula, :carnet, :tipo_registro, :cedula_invitado, :medio_identificacion, :observacion, :departamento_buscado, :persona_buscada, :tipo, :fecha, :hora)');
            $insert->execute([
                ':cedula' => $empleado['cedula'],
                ':carnet' => $empleado['carnet'],
                ':tipo_registro' => 'EMPLEADO',
                ':cedula_invitado' => null,
                ':medio_identificacion' => $medio,
                ':observacion' => $observacion,
                ':departamento_buscado' => null,
                ':persona_buscada' => null,
                ':tipo' => $tipo,
                ':fecha' => $fecha,
                ':hora' => $hora
            ]);

            json_response(201, [
                'ok' => true,
                'message' => sprintf('Marcacion %s registrada para %s%s.', $tipo, $empleado['nombre'], $medio === 'CEDULA' ? ' (sin carnet)' : ''),
                'data' => get_bootstrap_data($pdo)
            ]);
        }

        validate_guest_cedula($identificador);

        $ultimoMarcajeInvitado = get_last_attendance_for_guest($pdo, $identificador);
        enforce_alternating_mark($ultimoMarcajeInvitado, $tipo, 'invitado');

        if ($tipo === 'ENTRADA' && ($departamentoBuscado === '' || $personaBuscada === '')) {
            json_response(422, [
                'ok' => false,
                'message' => 'Para un invitado debes indicar el departamento y la persona que busca.'
            ]);
        }

        if ($tipo === 'ENTRADA') {
            $stmtPersona = $pdo->prepare('SELECT cedula, nombre, departamento FROM empleados WHERE cedula = :cedula LIMIT 1');
            $stmtPersona->execute([':cedula' => $personaBuscada]);
            $personaRegistrada = $stmtPersona->fetch();

            if (!$personaRegistrada) {
                json_response(422, [
                    'ok' => false,
                    'message' => 'La persona seleccionada no esta registrada en la base de datos.'
                ]);
            }

            if ((string) $personaRegistrada['departamento'] !== $departamentoBuscado) {
                json_response(422, [
                    'ok' => false,
                    'message' => 'La persona seleccionada no pertenece a ese departamento.'
                ]);
            }
        }

        $observacionBase = $tipo === 'ENTRADA' ? 'Ingreso de invitado' : 'Salida de invitado';
        $observacionInvitado = compose_observacion($observacionBase, $observacionManual);

        $insert = $pdo->prepare('INSERT INTO asistencias (cedula, carnet, tipo_registro, cedula_invitado, medio_identificacion, observacion, departamento_buscado, persona_buscada, tipo, fecha, hora) VALUES (:cedula, :carnet, :tipo_registro, :cedula_invitado, :medio_identificacion, :observacion, :departamento_buscado, :persona_buscada, :tipo, :fecha, :hora)');
        $insert->execute([
            ':cedula' => null,
            ':carnet' => null,
            ':tipo_registro' => 'INVITADO',
            ':cedula_invitado' => $identificador,
            ':medio_identificacion' => 'INVITADO',
            ':observacion' => $observacionInvitado,
            ':departamento_buscado' => $tipo === 'ENTRADA' ? $departamentoBuscado : null,
            ':persona_buscada' => $tipo === 'ENTRADA' ? $personaBuscada : null,
            ':tipo' => $tipo,
            ':fecha' => $fecha,
            ':hora' => $hora
        ]);

        json_response(201, [
            'ok' => true,
            'message' => sprintf('%s de invitado registrada con cedula %s.', $tipo === 'ENTRADA' ? 'Entrada' : 'Salida', $identificador),
            'data' => get_bootstrap_data($pdo)
        ]);
    }

    json_response(404, [
        'ok' => false,
        'message' => 'Ruta no encontrada.'
    ]);
} catch (PDOException $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    if ((int) $exception->getCode() === 23000) {
        $errorText = $exception->getMessage();
        $message = 'Ya existe un empleado con esa cedula.';

        if (stripos($errorText, 'uk_empleados_carnet') !== false || stripos($errorText, 'carnet') !== false) {
            $message = 'Ya existe un empleado con ese carnet.';
        }

        json_response(409, [
            'ok' => false,
            'message' => $message
        ]);
    }

    json_response(500, [
        'ok' => false,
        'message' => 'Error de base de datos.',
        'detail' => $exception->getMessage()
    ]);
} catch (Throwable $exception) {
    json_response(500, [
        'ok' => false,
        'message' => $exception->getMessage()
    ]);
}

function get_bootstrap_data(PDO $pdo): array
{
    $empleados = $pdo->query('SELECT cedula, carnet, nombre, departamento, cargo FROM empleados ORDER BY id DESC')->fetchAll();

    $asistencias = $pdo->query(
        "SELECT
            DATE_FORMAT(fecha, '%d/%m/%Y') AS fecha,
            DATE_FORMAT(hora, '%H:%i:%s') AS hora,
            tipo_registro,
            COALESCE(cedula, cedula_invitado) AS cedula,
            COALESCE(carnet, 'INVITADO') AS carnet,
            COALESCE(medio_identificacion, IF(tipo_registro = 'INVITADO', 'INVITADO', '-')) AS medio_identificacion,
            COALESCE(observacion, '') AS observacion,
            COALESCE(departamento_buscado, '') AS departamento_buscado,
            COALESCE(persona_buscada, '') AS persona_buscada,
            tipo
            FROM asistencias
            WHERE fecha = CURDATE()
         ORDER BY id DESC
            LIMIT 200"
    )->fetchAll();

    $asistenciasArchivadas = $pdo->query(
        "SELECT
              DATE_FORMAT(fecha, '%d/%m/%Y') AS fecha,
              DATE_FORMAT(hora, '%H:%i:%s') AS hora,
              tipo_registro,
              COALESCE(cedula, cedula_invitado) AS cedula,
              COALESCE(carnet, 'INVITADO') AS carnet,
              COALESCE(medio_identificacion, IF(tipo_registro = 'INVITADO', 'INVITADO', '-')) AS medio_identificacion,
              COALESCE(observacion, '') AS observacion,
                            COALESCE(departamento_buscado, '') AS departamento_buscado,
                            COALESCE(persona_buscada, '') AS persona_buscada,
              tipo,
              DATE_FORMAT(archivado_en, '%d/%m/%Y %H:%i:%s') AS archivado_en
            FROM asistencias_archivadas
            ORDER BY fecha DESC, hora DESC, id DESC
            LIMIT 500"
    )->fetchAll();

    $metricasStmt = $pdo->query(
        "SELECT
            (SELECT COUNT(*) FROM empleados) AS personal_activo,
            (SELECT COUNT(*) FROM asistencias WHERE fecha = CURDATE() AND tipo = 'ENTRADA') AS entradas_hoy,
            (SELECT COUNT(*) FROM asistencias WHERE fecha = CURDATE() AND tipo = 'SALIDA') AS salidas_hoy,
            (SELECT COUNT(*) FROM asistencias WHERE fecha = CURDATE()) AS marcaciones_hoy"
    );

    $metricas = $metricasStmt->fetch();

    return [
        'empleados' => $empleados,
        'asistencias' => $asistencias,
        'asistencias_archivadas' => $asistenciasArchivadas,
        'metricas' => [
            'personal_activo' => (int) $metricas['personal_activo'],
            'entradas_hoy' => (int) $metricas['entradas_hoy'],
            'salidas_hoy' => (int) $metricas['salidas_hoy'],
            'marcaciones_hoy' => (int) $metricas['marcaciones_hoy']
        ]
    ];
}

function archive_expired_attendance(PDO $pdo): void
{
    $pdo->beginTransaction();

    $pdo->exec(
        "INSERT IGNORE INTO asistencias_archivadas
                (origen_asistencia_id, cedula, carnet, tipo_registro, cedula_invitado, medio_identificacion, observacion, departamento_buscado, persona_buscada, tipo, fecha, hora)
         SELECT
            a.id,
            a.cedula,
            a.carnet,
            a.tipo_registro,
            a.cedula_invitado,
            a.medio_identificacion,
            a.observacion,
                a.departamento_buscado,
                a.persona_buscada,
            a.tipo,
            a.fecha,
            a.hora
         FROM asistencias a
         WHERE a.fecha < CURDATE()"
    );

    $pdo->exec('DELETE FROM asistencias WHERE fecha < CURDATE()');

    $pdo->commit();
}

function get_json_input(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('JSON invalido.');
    }

    return $decoded;
}

function validate_required(array $payload, array $required): void
{
    foreach ($required as $field) {
        if (!isset($payload[$field])) {
            throw new RuntimeException(sprintf('Falta el campo requerido: %s', $field));
        }

        if (trim((string) $payload[$field]) === '') {
            throw new RuntimeException(sprintf('El campo %s es obligatorio.', $field));
        }
    }
}

function normalize_text(string $value): string
{
    return trim($value);
}

function validate_identifier(string $identificador): void
{
    if (!preg_match('/^[0-9A-Za-z-]{4,30}$/', $identificador)) {
        throw new RuntimeException('El identificador debe tener entre 4 y 30 caracteres alfanumericos.');
    }
}

function validate_guest_cedula(string $cedula): void
{
    if (!preg_match('/^[0-9A-Z-]{4,20}$/', $cedula)) {
        throw new RuntimeException('La cedula del invitado debe tener entre 4 y 20 caracteres alfanumericos.');
    }
}

function validate_observacion(string $observacion): void
{
    if ($observacion === '') {
        return;
    }

    if (mb_strlen($observacion) > 255) {
        throw new RuntimeException('La observacion no puede superar 255 caracteres.');
    }
}

function validate_guest_context(string $departamentoBuscado, string $personaBuscada): void
{
    if (mb_strlen($departamentoBuscado) > 120) {
        throw new RuntimeException('El departamento buscado no puede superar 120 caracteres.');
    }

    if (mb_strlen($personaBuscada) > 120) {
        throw new RuntimeException('La persona buscada no puede superar 120 caracteres.');
    }
}

function compose_observacion(string $base, string $manual): ?string
{
    $base = trim($base);
    $manual = trim($manual);

    if ($base !== '' && $manual !== '') {
        return sprintf('%s. %s', $base, $manual);
    }

    if ($base !== '') {
        return $base;
    }

    if ($manual !== '') {
        return $manual;
    }

    return null;
}

function validate_employee_payload(array $payload): void
{
    $cedula = normalize_text((string) $payload['cedula']);
    $carnet = normalize_text((string) $payload['carnet']);
    $nombre = normalize_text((string) $payload['nombre']);
    $cargo = normalize_text((string) $payload['cargo']);

    if (!preg_match('/^[0-9A-Za-z-]{4,20}$/', $cedula)) {
        throw new RuntimeException('La cedula debe tener entre 4 y 20 caracteres alfanumericos.');
    }

    if (!preg_match('/^[0-9A-Za-z-]{4,30}$/', $carnet)) {
        throw new RuntimeException('El carnet debe tener entre 4 y 30 caracteres alfanumericos.');
    }

    if (mb_strlen($nombre) < 4) {
        throw new RuntimeException('El nombre completo debe tener al menos 4 caracteres.');
    }

    if (mb_strlen($cargo) < 2) {
        throw new RuntimeException('El cargo es demasiado corto.');
    }
}

function get_last_attendance_for_employee(PDO $pdo, string $cedula): ?array
{
    $stmt = $pdo->prepare(
        'SELECT tipo, tipo_registro
         FROM asistencias
         WHERE tipo_registro = "EMPLEADO" AND cedula = :cedula
         ORDER BY id DESC
         LIMIT 1'
    );
    $stmt->execute([':cedula' => $cedula]);
    $row = $stmt->fetch();

    return $row ?: null;
}

function get_last_attendance_for_guest(PDO $pdo, string $cedula): ?array
{
    $stmt = $pdo->prepare(
        'SELECT tipo, tipo_registro
         FROM asistencias
         WHERE tipo_registro = "INVITADO" AND cedula_invitado = :cedula
         ORDER BY id DESC
         LIMIT 1'
    );
    $stmt->execute([':cedula' => $cedula]);
    $row = $stmt->fetch();

    return $row ?: null;
}

function enforce_alternating_mark(?array $lastAttendance, string $currentType, string $personaType): void
{
    if ($lastAttendance === null) {
        if ($currentType === 'SALIDA') {
            json_response(422, [
                'ok' => false,
                'message' => sprintf('Primero debes marcar entrada antes de registrar salida para %s.', $personaType)
            ]);
        }

        return;
    }

    if (($lastAttendance['tipo'] ?? '') === $currentType) {
        json_response(422, [
            'ok' => false,
            'message' => $currentType === 'ENTRADA'
                ? sprintf('Ya existe una entrada activa. Debes marcar salida antes de volver a entrar como %s.', $personaType)
                : sprintf('Ya existe una salida registrada. Debes marcar entrada antes de volver a salir como %s.', $personaType)
        ]);
    }
}

function json_response(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function ensure_schema(PDO $pdo): void
{
    ensure_column($pdo, 'empleados', 'carnet', 'VARCHAR(30) NULL AFTER cedula');
    ensure_unique_index($pdo, 'empleados', 'uk_empleados_carnet', 'carnet');

    ensure_column($pdo, 'asistencias', 'carnet', 'VARCHAR(30) NULL AFTER cedula');
    ensure_column($pdo, 'asistencias', 'tipo_registro', "ENUM('EMPLEADO', 'INVITADO') NOT NULL DEFAULT 'EMPLEADO' AFTER carnet");
    ensure_column($pdo, 'asistencias', 'cedula_invitado', 'VARCHAR(20) NULL AFTER tipo_registro');
    ensure_column($pdo, 'asistencias', 'medio_identificacion', "ENUM('CARNET', 'CEDULA', 'INVITADO') NULL AFTER cedula_invitado");
    ensure_column($pdo, 'asistencias', 'observacion', 'VARCHAR(255) NULL AFTER medio_identificacion');
    ensure_column($pdo, 'asistencias', 'departamento_buscado', 'VARCHAR(120) NULL AFTER observacion');
    ensure_column($pdo, 'asistencias', 'persona_buscada', 'VARCHAR(120) NULL AFTER departamento_buscado');
    ensure_index($pdo, 'asistencias', 'idx_asistencias_carnet', 'carnet');
    ensure_index($pdo, 'asistencias', 'idx_asistencias_tipo_registro', 'tipo_registro');
    ensure_index($pdo, 'asistencias', 'idx_asistencias_cedula_invitado', 'cedula_invitado');

    $pdo->exec("UPDATE empleados SET carnet = cedula WHERE carnet IS NULL OR carnet = ''");
    $pdo->exec("UPDATE asistencias SET medio_identificacion = IF(tipo_registro = 'INVITADO', 'INVITADO', IF(carnet IS NOT NULL AND carnet <> '', 'CARNET', 'CEDULA')) WHERE medio_identificacion IS NULL");
    $pdo->exec("UPDATE asistencias SET observacion = 'Ingreso de invitado' WHERE tipo_registro = 'INVITADO' AND (observacion IS NULL OR observacion = '')");
}

function ensure_column(PDO $pdo, string $table, string $column, string $definition): void
{
    if (column_exists($pdo, $table, $column)) {
        return;
    }

    $pdo->exec(sprintf('ALTER TABLE %s ADD COLUMN %s %s', $table, $column, $definition));
}

function ensure_index(PDO $pdo, string $table, string $indexName, string $column): void
{
    if (index_exists($pdo, $table, $indexName)) {
        return;
    }

    $pdo->exec(sprintf('ALTER TABLE %s ADD INDEX %s (%s)', $table, $indexName, $column));
}

function ensure_unique_index(PDO $pdo, string $table, string $indexName, string $column): void
{
    if (index_exists($pdo, $table, $indexName)) {
        return;
    }

    $pdo->exec(sprintf('ALTER TABLE %s ADD UNIQUE INDEX %s (%s)', $table, $indexName, $column));
}

function column_exists(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name AND COLUMN_NAME = :column_name'
    );
    $stmt->execute([
        ':table_name' => $table,
        ':column_name' => $column
    ]);

    return (int) $stmt->fetchColumn() > 0;
}

function index_exists(PDO $pdo, string $table, string $indexName): bool
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name AND INDEX_NAME = :index_name'
    );
    $stmt->execute([
        ':table_name' => $table,
        ':index_name' => $indexName
    ]);

    return (int) $stmt->fetchColumn() > 0;
}
