<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/db.php';

$config = require __DIR__ . '/config.php';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';

try {
    $pdo = db_connection();

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
            $medio = $empleadoPorCarnet ? 'CARNET' : 'CEDULA';
            $observacion = $medio === 'CEDULA'
                ? ($tipo === 'ENTRADA' ? 'Ingreso sin carnet' : 'Marcaje sin carnet')
                : null;

            $insert = $pdo->prepare('INSERT INTO asistencias (cedula, carnet, tipo_registro, cedula_invitado, medio_identificacion, observacion, tipo, fecha, hora) VALUES (:cedula, :carnet, :tipo_registro, :cedula_invitado, :medio_identificacion, :observacion, :tipo, :fecha, :hora)');
            $insert->execute([
                ':cedula' => $empleado['cedula'],
                ':carnet' => $empleado['carnet'],
                ':tipo_registro' => 'EMPLEADO',
                ':cedula_invitado' => null,
                ':medio_identificacion' => $medio,
                ':observacion' => $observacion,
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

        if ($tipo !== 'ENTRADA') {
            json_response(422, [
                'ok' => false,
                'message' => 'Para invitados solo se permite ENTRADA con cedula.'
            ]);
        }

        $insert = $pdo->prepare('INSERT INTO asistencias (cedula, carnet, tipo_registro, cedula_invitado, medio_identificacion, observacion, tipo, fecha, hora) VALUES (:cedula, :carnet, :tipo_registro, :cedula_invitado, :medio_identificacion, :observacion, :tipo, :fecha, :hora)');
        $insert->execute([
            ':cedula' => null,
            ':carnet' => null,
            ':tipo_registro' => 'INVITADO',
            ':cedula_invitado' => $identificador,
            ':medio_identificacion' => 'INVITADO',
            ':observacion' => 'Ingreso de invitado',
            ':tipo' => $tipo,
            ':fecha' => $fecha,
            ':hora' => $hora
        ]);

        json_response(201, [
            'ok' => true,
            'message' => sprintf('Entrada de invitado registrada con cedula %s.', $identificador),
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
            tipo
         FROM asistencias
         ORDER BY id DESC
         LIMIT 120"
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
        'metricas' => [
            'personal_activo' => (int) $metricas['personal_activo'],
            'entradas_hoy' => (int) $metricas['entradas_hoy'],
            'salidas_hoy' => (int) $metricas['salidas_hoy'],
            'marcaciones_hoy' => (int) $metricas['marcaciones_hoy']
        ]
    ];
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

function json_response(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
