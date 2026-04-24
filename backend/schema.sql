CREATE DATABASE IF NOT EXISTS sca_corpoelec CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sca_corpoelec;

CREATE TABLE IF NOT EXISTS usuarios (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    usuario VARCHAR(60) NOT NULL,
    clave VARCHAR(255) NOT NULL,
    nombre_mostrar VARCHAR(120) NOT NULL,
    rol VARCHAR(40) NOT NULL DEFAULT 'admin',
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_usuarios_usuario (usuario)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS departamentos (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nombre VARCHAR(120) NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_departamentos_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS empleados (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    cedula VARCHAR(20) NOT NULL,
    carnet VARCHAR(30) NOT NULL,
    nombre VARCHAR(120) NOT NULL,
    departamento VARCHAR(120) NOT NULL,
    cargo VARCHAR(120) NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_empleados_cedula (cedula),
    UNIQUE KEY uk_empleados_carnet (carnet)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS asistencias (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    cedula VARCHAR(20) NULL,
    carnet VARCHAR(30) NULL,
    tipo_registro ENUM('EMPLEADO', 'INVITADO') NOT NULL DEFAULT 'EMPLEADO',
    cedula_invitado VARCHAR(20) NULL,
    medio_identificacion ENUM('CARNET', 'CEDULA', 'INVITADO') NULL,
    observacion VARCHAR(255) NULL,
    tipo ENUM('ENTRADA', 'SALIDA') NOT NULL,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_asistencias_fecha (fecha),
    KEY idx_asistencias_cedula (cedula),
    KEY idx_asistencias_carnet (carnet),
    KEY idx_asistencias_tipo_registro (tipo_registro),
    KEY idx_asistencias_cedula_invitado (cedula_invitado),
    CONSTRAINT fk_asistencias_empleado FOREIGN KEY (cedula)
        REFERENCES empleados (cedula)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE empleados ADD COLUMN IF NOT EXISTS carnet VARCHAR(30) NULL AFTER cedula;
UPDATE empleados SET carnet = cedula WHERE carnet IS NULL OR carnet = '';
ALTER TABLE empleados MODIFY carnet VARCHAR(30) NOT NULL;
ALTER TABLE empleados ADD UNIQUE INDEX IF NOT EXISTS uk_empleados_carnet (carnet);

ALTER TABLE asistencias ADD COLUMN IF NOT EXISTS carnet VARCHAR(30) NULL AFTER cedula;
ALTER TABLE asistencias ADD COLUMN IF NOT EXISTS tipo_registro ENUM('EMPLEADO', 'INVITADO') NOT NULL DEFAULT 'EMPLEADO' AFTER carnet;
ALTER TABLE asistencias ADD COLUMN IF NOT EXISTS cedula_invitado VARCHAR(20) NULL AFTER tipo_registro;
ALTER TABLE asistencias ADD COLUMN IF NOT EXISTS medio_identificacion ENUM('CARNET', 'CEDULA', 'INVITADO') NULL AFTER cedula_invitado;
ALTER TABLE asistencias ADD COLUMN IF NOT EXISTS observacion VARCHAR(255) NULL AFTER medio_identificacion;
UPDATE asistencias a
INNER JOIN empleados e ON e.cedula = a.cedula
SET a.carnet = e.carnet
WHERE a.carnet IS NULL OR a.carnet = '';
UPDATE asistencias
SET medio_identificacion = IF(tipo_registro = 'INVITADO', 'INVITADO', IF(carnet IS NOT NULL AND carnet <> '', 'CARNET', 'CEDULA'))
WHERE medio_identificacion IS NULL;
UPDATE asistencias
SET observacion = 'Ingreso de invitado'
WHERE tipo_registro = 'INVITADO' AND (observacion IS NULL OR observacion = '');
ALTER TABLE asistencias MODIFY cedula VARCHAR(20) NULL;
ALTER TABLE asistencias MODIFY carnet VARCHAR(30) NULL;
ALTER TABLE asistencias ADD INDEX IF NOT EXISTS idx_asistencias_carnet (carnet);
ALTER TABLE asistencias ADD INDEX IF NOT EXISTS idx_asistencias_tipo_registro (tipo_registro);
ALTER TABLE asistencias ADD INDEX IF NOT EXISTS idx_asistencias_cedula_invitado (cedula_invitado);

INSERT INTO usuarios (usuario, clave, nombre_mostrar, rol)
VALUES ('admin_cabimas', '123456', 'Administrador Cabimas', 'admin')
ON DUPLICATE KEY UPDATE
    clave = VALUES(clave),
    nombre_mostrar = VALUES(nombre_mostrar),
    rol = VALUES(rol);

INSERT INTO departamentos (nombre)
VALUES
    ('Gerencia de Tecnologia (ASIT)'),
    ('Recursos Humanos'),
    ('Prevencion y Proteccion (PCP)'),
    ('Distribucion'),
    ('Comercial')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

INSERT INTO empleados (cedula, carnet, nombre, departamento, cargo)
VALUES ('V10000000', 'CAR-10000000', 'Usuario Demo', 'Gerencia de Tecnologia (ASIT)', 'Analista')
ON DUPLICATE KEY UPDATE
    carnet = VALUES(carnet),
    nombre = VALUES(nombre),
    departamento = VALUES(departamento),
    cargo = VALUES(cargo);
