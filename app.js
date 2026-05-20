const APP_CONFIG = {
    appName: 'SCA CORPOELEC',
    backend: {
        mode: 'auto',
        endpoint: 'backend/api.php'
    },
    storageKeys: {
        empleados: 'sca_empleados',
        asistencias: 'sca_asistencias',
        archivadas: 'sca_asistencias_archivadas'
    },
    auth: {
        seguridad: { username: 'seguridad', password: 'seg123' },
        rrhh: { username: 'rrhh', password: 'rrhh123' }
    },
    departamentos: [
        'Gerencia de Tecnologia (ASIT)',
        'Recursos Humanos',
        'Prevencion y Proteccion (PCP)',
        'Distribucion',
        'Comercial'
    ],
    cargos: [
        'Analista',
        'Supervisor',
        'Tecnico',
        'Coordinador',
        'Gerente'
    ],
    menu: [
        { id: 'screen-asistencia', label: 'Asistencia' },
        { id: 'screen-dashboard', label: 'Dashboard' },
        { id: 'screen-empleados', label: 'Empleados' },
        { id: 'screen-archivo', label: 'Archivo' },
        { id: 'screen-reportes', label: 'Reportes' }
    ]
};

const state = {
    session: {
        logged: false,
        activeScreen: 'screen-login',
        role: ''
    },
    editingEmpleadoCedula: null,
    backendOnline: false,
    empleados: [],
    asistencias: [],
    asistenciasArchivadas: [],
    archive: {
        lastCheckKey: null
    },
    attendanceMode: 'ENTRADA',
    dashboard: {
        empleadoCedula: '',
        departamento: ''
    },
    metricas: {
        personal_activo: 0,
        personal_vacaciones: 0,
        personal_suspendido: 0,
        entradas_hoy: 0,
        salidas_hoy: 0,
        marcaciones_hoy: 0
    },
    reporte: {
        tipo: null,
        columns: [],
        rows: [],
        summaryColumns: [],
        summaryRows: [],
        title: '',
        subtitle: '',
        filters: {
            fecha: '',
            tipo: 'TODOS'
        }
    }
};

function getDefaultScreenForRole(role) {
    const r = String(role || '').toUpperCase();
    if (r === 'SEGURIDAD') return 'screen-archivo';
    // RRHH and others default to dashboard
    return 'screen-dashboard';
}

function isScreenAllowedForRole(screenId, role) {
    const r = String(role || '').toUpperCase();

    if (!r) return true;

    if (r === 'SEGURIDAD') {
        // seguridad ve archivo y marcaje (y login)
        return screenId === 'screen-archivo' || screenId === 'screen-asistencia' || screenId === 'screen-login';
    }

    if (r === 'RRHH') {
        // RRHH ve todo excepto marcaje (screen-asistencia)
        return screenId !== 'screen-asistencia';
    }

    return true;
}

const el = {
    header: document.getElementById('app-header'),
    menu: document.getElementById('menu-principal'),
    btnCerrarSesion: document.getElementById('btn-cerrar-sesion'),
    screens: {
        login: document.getElementById('screen-login'),
        dashboard: document.getElementById('screen-dashboard'),
        empleados: document.getElementById('screen-empleados'),
        asistencia: document.getElementById('screen-asistencia'),
        archivo: document.getElementById('screen-archivo'),
        reportes: document.getElementById('screen-reportes')
    }
};

function useRemoteBackend() {
    return isApiEnabled() && state.backendOnline;
}

function isApiEnabled() {
    if (APP_CONFIG.backend.mode === 'api') {
        return true;
    }

    if (APP_CONFIG.backend.mode === 'local') {
        return false;
    }

    return window.location.protocol.startsWith('http');
}

async function apiRequest(action, method = 'GET', body = null) {
    const url = `${APP_CONFIG.backend.endpoint}?action=${encodeURIComponent(action)}`;
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
        throw new Error(payload.message || 'Error inesperado en la API.');
    }

    return payload;
}

async function init() {
    mountTemplates();
    renderMenu();
    bindGlobalEvents();
    bindScreenEvents();

    await hydrateData();
    renderAll();
    updateClock();
    setInterval(updateClock, 1000);
}

async function hydrateData() {
    if (isApiEnabled()) {
        try {
            const payload = await apiRequest('bootstrap', 'GET');
            applyBootstrapData(payload.data);
            state.backendOnline = true;
            state.archive.lastCheckKey = getDayKey(new Date());
            return;
        } catch {
            state.backendOnline = false;
        }
    }

    state.empleados = readStorage(APP_CONFIG.storageKeys.empleados, []);
    state.asistencias = readStorage(APP_CONFIG.storageKeys.asistencias, []);
    state.asistenciasArchivadas = readStorage(APP_CONFIG.storageKeys.archivadas, []);
    state.metricas = buildLocalMetrics();

    await ensureAttendanceArchive(true);
}

function applyBootstrapData(data) {
    state.empleados = data.empleados || [];
    state.asistencias = data.asistencias || [];
    state.asistenciasArchivadas = data.asistencias_archivadas || [];
    state.metricas = data.metricas || buildLocalMetrics();
    if (state.reporte.tipo) {
        renderReportPreview(state.reporte.tipo);
    }
    syncCargoOptions();
    syncEmployeeDepartmentFilterOptions();
}

function syncCargoOptions() {
    const cargoSelect = document.getElementById('cargo-select');
    if (!cargoSelect) return;

    const existing = new Set(APP_CONFIG.cargos || []);
    (state.empleados || []).forEach((e) => {
        if (e && e.cargo) existing.add(e.cargo);
    });

    const options = ['<option value="">Selecciona un cargo</option>', ...Array.from(existing).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)];
    const current = cargoSelect.value;
    cargoSelect.innerHTML = options.join('');
    if (current) cargoSelect.value = current;
}

function syncEmployeeDepartmentFilterOptions() {
    const filtroDepartamento = document.getElementById('filtro-departamento-empleados');
    if (!filtroDepartamento) return;

    const current = filtroDepartamento.value;
    const departamentos = new Set(APP_CONFIG.departamentos || []);
    (state.empleados || []).forEach((emp) => {
        if (emp && emp.departamento) {
            departamentos.add(String(emp.departamento));
        }
    });

    filtroDepartamento.innerHTML = ['<option value="">Todos</option>', ...Array.from(departamentos).sort((a, b) => a.localeCompare(b, 'es')).map((dep) => `<option value="${escapeHtml(dep)}">${escapeHtml(dep)}</option>`)].join('');
    if (current) {
        filtroDepartamento.value = current;
    }
}

function mountTemplates() {
    el.screens.login.innerHTML = getTemplate('tpl-login');
    el.screens.dashboard.innerHTML = getTemplate('tpl-dashboard');
    el.screens.empleados.innerHTML = getTemplate('tpl-empleados');
    el.screens.asistencia.innerHTML = getTemplate('tpl-asistencia');
    el.screens.archivo.innerHTML = getTemplate('tpl-archivo');
    el.screens.reportes.innerHTML = getTemplate('tpl-reportes');

    const deptSelect = document.getElementById('departamento-select');
    deptSelect.innerHTML = APP_CONFIG.departamentos
        .map((dep) => `<option value="${dep}">${dep}</option>`)
        .join('');

    const cargoSelect = document.getElementById('cargo-select');
    if (cargoSelect) {
        cargoSelect.innerHTML = ['<option value="">Selecciona un cargo</option>', ...APP_CONFIG.cargos.map((c) => `<option value="${c}">${c}</option>`)].join('');
    }

    const asistenciaDeptSelect = document.getElementById('asistencia-departamento');
    if (asistenciaDeptSelect) {
        asistenciaDeptSelect.innerHTML = ['<option value="">Selecciona un departamento</option>', ...APP_CONFIG.departamentos.map((dep) => `<option value="${dep}">${dep}</option>`)].join('');
    }

    fillGuestPersonSelect();
    updateGuestFieldsVisibility();
    // Mostrar/ocultar campo pequeño para observación personalizada (opción 'Otro')
    const observacionSelect = document.getElementById('asistencia-observacion');
    const observacionOtro = document.getElementById('asistencia-observacion-otro');
    const reporteFecha = document.getElementById('reporte-fecha-asistencia');
    const reporteTipo = document.getElementById('reporte-tipo-asistencia');

    if (reporteFecha && !reporteFecha.value) {
        reporteFecha.value = getLocalDateInputValue(new Date());
    }

    if (reporteTipo && !reporteTipo.value) {
        reporteTipo.value = 'TODOS';
    }

    const estadoSelect = document.getElementById('estado-select');
    if (estadoSelect && !estadoSelect.value) {
        estadoSelect.value = 'ACTIVO';
    }

    syncEmployeeDepartmentFilterOptions();

    function updateObservationInputVisibility() {
        if (!observacionSelect || !observacionOtro) return;
        if (observacionSelect.value === 'Otro') {
            observacionOtro.classList.remove('hidden');
            try { observacionOtro.focus(); } catch (e) { }
        } else {
            observacionOtro.classList.add('hidden');
            observacionOtro.value = '';
        }
    }

    if (observacionSelect) {
        observacionSelect.addEventListener('change', updateObservationInputVisibility);
        updateObservationInputVisibility();
    }

    syncReportPreviewEmptyState();
}

function getTemplate(id) {
    const tpl = document.getElementById(id);
    return tpl ? tpl.innerHTML : '';
}

function bindGlobalEvents() {
    el.btnCerrarSesion.addEventListener('click', () => {
        state.session.logged = false;
        state.session.role = '';
        renderMenu();
        showScreen('screen-login');
        renderAll();
    });
}

function bindScreenEvents() {
    document.getElementById('form-login').addEventListener('submit', onLogin);
    document.getElementById('form-empleado').addEventListener('submit', onEmpleadoSubmit);
    document.getElementById('btn-cancelar-edicion-empleado').addEventListener('click', onCancelarEdicionEmpleado);
    const btnLimpiarFiltrosEmpleados = document.getElementById('btn-limpiar-filtros-empleados');
    if (btnLimpiarFiltrosEmpleados) {
        btnLimpiarFiltrosEmpleados.addEventListener('click', onLimpiarFiltrosEmpleados);
    }
    document.getElementById('btn-limpiar-empleados').addEventListener('click', onLimpiarEmpleados);
    document.getElementById('btn-actualizar-archivo').addEventListener('click', onActualizarArchivo);

    document
        .querySelectorAll('[data-tipo]')
        .forEach((button) => button.addEventListener('click', () => {
            state.attendanceMode = button.dataset.tipo;
            updateGuestFieldsVisibility();
            onRegistrarAsistencia(button.dataset.tipo);
        }));

    const asistenciaIdentificador = document.getElementById('asistencia-identificador');
    if (asistenciaIdentificador) {
        asistenciaIdentificador.addEventListener('input', () => {
            updateGuestFieldsVisibility();
            updateAttendanceEmployeeInfo();
        });
    }

    document.getElementById('btn-previa-empleados').addEventListener('click', () => renderReportPreview('empleados'));
    document.getElementById('btn-previa-asistencia').addEventListener('click', () => renderReportPreview('asistencia'));
    document.getElementById('btn-aplicar-filtro-reporte').addEventListener('click', () => renderReportPreview('asistencia'));
    document.getElementById('reporte-fecha-asistencia').addEventListener('change', () => {
        if (state.reporte.tipo === 'asistencia') {
            renderReportPreview('asistencia');
        }
    });
    document.getElementById('reporte-tipo-asistencia').addEventListener('change', () => {
        if (state.reporte.tipo === 'asistencia') {
            renderReportPreview('asistencia');
        }
    });
    const dashboardFecha = document.getElementById('dashboard-fecha');
    if (dashboardFecha) {
        dashboardFecha.addEventListener('change', () => renderDashboard());
    }
    const dashboardEmpleado = document.getElementById('dashboard-filtro-empleado');
    if (dashboardEmpleado) {
        dashboardEmpleado.addEventListener('change', () => renderDashboard());
    }
    const dashboardDepartamento = document.getElementById('dashboard-filtro-departamento');
    if (dashboardDepartamento) {
        dashboardDepartamento.addEventListener('change', () => renderDashboard());
    }
    const filtroEstadoEmpleados = document.getElementById('filtro-estado-empleados');
    if (filtroEstadoEmpleados) {
        filtroEstadoEmpleados.addEventListener('change', () => renderTablaEmpleados());
    }
    const filtroNombreEmpleados = document.getElementById('filtro-nombre-empleados');
    if (filtroNombreEmpleados) {
        filtroNombreEmpleados.addEventListener('input', () => renderTablaEmpleados());
    }
    const filtroDepartamentoEmpleados = document.getElementById('filtro-departamento-empleados');
    if (filtroDepartamentoEmpleados) {
        filtroDepartamentoEmpleados.addEventListener('change', () => renderTablaEmpleados());
    }
    document.getElementById('btn-descargar-pdf').addEventListener('click', () => downloadCurrentReport('pdf'));
}

async function onLogin(event) {
    event.preventDefault();
    syncDashboardFilterOptions();

    const user = document.getElementById('login-user').value.trim();
    const pass = document.getElementById('login-pass').value;
    const feedback = document.getElementById('login-feedback');

    try {
        let loginPayload = null;
        if (useRemoteBackend()) {
            loginPayload = await apiRequest('login', 'POST', { user, pass });
        } else {
            // local fallback: soporta usuarios de prueba para SEGURIDAD y RRHH
            const seguridad = APP_CONFIG.auth.seguridad || {};
            const rrhh = APP_CONFIG.auth.rrhh || {};

            if (user === seguridad.username && pass === seguridad.password) {
                loginPayload = { role: 'SEGURIDAD' };
            } else if (user === rrhh.username && pass === rrhh.password) {
                loginPayload = { role: 'RRHH' };
            } else {
                throw new Error('Credenciales invalidas.');
            }
        }

        state.session.logged = true;
        state.session.role = (loginPayload && loginPayload.role) ? String(loginPayload.role).toUpperCase() : 'RRHH';
        feedback.textContent = 'Acceso correcto.';
        feedback.className = 'feedback ok';
        const defaultScreen = getDefaultScreenForRole(state.session.role);
        renderMenu();
        showScreen(defaultScreen);
        renderAll();
    } catch (error) {
        feedback.textContent = error.message;
        feedback.className = 'feedback error';
    }
}

async function onEmpleadoSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const originalCedula = String(formData.get('originalCedula') || '').trim();
    const isEditing = Boolean(originalCedula);
    const nuevoEmpleado = {
        nombre: String(formData.get('nombre') || '').trim(),
        cedula: String(formData.get('cedula') || '').trim(),
        carnet: String(formData.get('carnet') || '').trim(),
        departamento: String(formData.get('departamento') || '').trim(),
        cargo: String(formData.get('cargo') || '').trim(),
        estado: String(formData.get('estado') || 'ACTIVO').trim().toUpperCase()
    };

    const feedback = document.getElementById('empleado-feedback');

    const validacion = validarEmpleado(nuevoEmpleado);
    if (!validacion.ok) {
        feedback.textContent = validacion.message;
        feedback.className = 'feedback error';
        return;
    }

    try {
        if (useRemoteBackend()) {
            const payload = await apiRequest(
                isEditing ? 'employee_update' : 'employee_create',
                'POST',
                isEditing
                    ? { original_cedula: originalCedula, ...nuevoEmpleado }
                    : nuevoEmpleado
            );
            applyBootstrapData(payload.data);
            state.backendOnline = true;
        } else {
            if (isEditing) {
                const index = state.empleados.findIndex((emp) => emp.cedula === originalCedula);
                if (index === -1) {
                    throw new Error('No se encontro el empleado a modificar.');
                }

                const cedulaDuplicada = state.empleados.some(
                    (emp) => emp.cedula === nuevoEmpleado.cedula && emp.cedula !== originalCedula
                );

                const carnetDuplicado = state.empleados.some(
                    (emp) => emp.carnet === nuevoEmpleado.carnet && emp.cedula !== originalCedula
                );

                if (cedulaDuplicada) {
                    throw new Error('Ya existe un empleado con esa cedula.');
                }

                if (carnetDuplicado) {
                    throw new Error('Ya existe un empleado con ese carnet.');
                }

                state.empleados[index] = nuevoEmpleado;

                if (originalCedula !== nuevoEmpleado.cedula) {
                    state.asistencias = state.asistencias.map((registro) =>
                        registro.cedula === originalCedula
                            ? { ...registro, cedula: nuevoEmpleado.cedula }
                            : registro
                    );
                }
            } else {
                if (state.empleados.some((emp) => emp.cedula === nuevoEmpleado.cedula)) {
                    throw new Error('Ya existe un empleado con esa cedula.');
                }

                if (state.empleados.some((emp) => emp.carnet === nuevoEmpleado.carnet)) {
                    throw new Error('Ya existe un empleado con ese carnet.');
                }

                state.empleados.push(nuevoEmpleado);
            }

            persistData();
        }

        resetEmpleadoForm();
        feedback.textContent = isEditing
            ? 'Empleado actualizado correctamente.'
            : 'Empleado guardado correctamente.';
        feedback.className = 'feedback ok';
        renderAll();
    } catch (error) {
        feedback.textContent = error.message;
        feedback.className = 'feedback error';
    }
}

function onCancelarEdicionEmpleado() {
    resetEmpleadoForm();
    const feedback = document.getElementById('empleado-feedback');
    feedback.textContent = 'Edicion cancelada.';
    feedback.className = 'feedback';
}

async function onLimpiarEmpleados() {
    if (!confirm('Se eliminara el listado de empleados y asistencias. Desea continuar?')) {
        return;
    }

    try {
        if (useRemoteBackend()) {
            const payload = await apiRequest('employees_clear', 'POST', {});
            applyBootstrapData(payload.data);
            state.backendOnline = true;
        } else {
            state.empleados = [];
            state.asistencias = [];
            persistData();
        }

        renderAll();
    } catch (error) {
        const feedback = document.getElementById('empleado-feedback');
        feedback.textContent = error.message;
        feedback.className = 'feedback error';
    }
}

function onLimpiarFiltrosEmpleados() {
    const filtroNombre = document.getElementById('filtro-nombre-empleados');
    const filtroDepartamento = document.getElementById('filtro-departamento-empleados');
    const filtroEstado = document.getElementById('filtro-estado-empleados');

    if (filtroNombre) {
        filtroNombre.value = '';
    }

    if (filtroDepartamento) {
        filtroDepartamento.value = '';
    }

    if (filtroEstado) {
        filtroEstado.value = '';
    }

    renderTablaEmpleados();
}

async function onActualizarArchivo() {
    const feedback = document.getElementById('archivo-feedback');

    try {
        await ensureAttendanceArchive(true);
        feedback.textContent = 'Archivo actualizado correctamente.';
        feedback.className = 'feedback ok';
        renderArchivo();
    } catch (error) {
        feedback.textContent = error.message;
        feedback.className = 'feedback error';
    }
}

async function onRegistrarAsistencia(tipo) {
    const identificadorInput = document.getElementById('asistencia-identificador');
    const observacionSelect = document.getElementById('asistencia-observacion');
    const observacionOtro = document.getElementById('asistencia-observacion-otro');
    const empleadoInfo = document.getElementById('asistencia-empleado-info');
    const empleadoNombre = document.getElementById('asistencia-empleado-nombre');
    const empleadoDepartamento = document.getElementById('asistencia-empleado-departamento');
    const feedback = document.getElementById('asistencia-feedback');
    const identificador = identificadorInput.value.trim().toUpperCase();
    const departamentoInput = document.getElementById('asistencia-departamento');
    const personaInput = document.getElementById('asistencia-persona');
    const departamentoBuscado = String(departamentoInput?.value || '').trim();
    // Obtener cédula y nombre de la persona seleccionada en la lista
    let personaBuscada = '';
    let personaBuscadaNombre = '';
    if (personaInput && personaInput.selectedIndex > -1) {
        personaBuscada = String(personaInput.value || '').trim();
        const sel = personaInput.options[personaInput.selectedIndex];
        personaBuscadaNombre = (sel && (sel.getAttribute('data-nombre') || (sel.textContent || '').split(' - ')[0])) || '';
    }
    let observacionManual = '';
    if (observacionOtro && !observacionOtro.classList.contains('hidden') && observacionOtro.value.trim()) {
        observacionManual = String(observacionOtro.value || '').trim();
    } else if (observacionSelect && observacionSelect.value && observacionSelect.value !== 'Otro') {
        observacionManual = String(observacionSelect.value || '').trim();
    } else {
        observacionManual = '';
    }

    if (!identificador) {
        feedback.textContent = 'Debes ingresar carnet (empleado) o cedula (invitado).';
        feedback.className = 'feedback error';
        return;
    }

    try {
        if (useRemoteBackend()) {
            const payload = await apiRequest('attendance_mark', 'POST', {
                identificador,
                tipo,
                observacion: observacionManual,
                departamento_buscado: departamentoBuscado,
                persona_buscada: personaBuscada
            });
            applyBootstrapData(payload.data);
            feedback.textContent = payload.message || 'Marcacion registrada.';
            state.backendOnline = true;
        } else {
            const empleadoPorCarnet = state.empleados.find((emp) => String(emp.carnet || '').toUpperCase() === identificador);
            const empleadoPorCedula = state.empleados.find((emp) => String(emp.cedula || '').toUpperCase() === identificador);
            const empleado = empleadoPorCarnet || empleadoPorCedula;
            const tipoRegistro = empleado ? 'EMPLEADO' : 'INVITADO';
            const clavePersona = empleado ? empleado.cedula : identificador;
            const ultimoMarcaje = getUltimoMarcajeLocal(tipoRegistro, clavePersona);

            if (ultimoMarcaje && ultimoMarcaje.tipo === tipo) {
                throw new Error(tipo === 'ENTRADA'
                    ? 'Ya existe una entrada activa. Debes marcar salida antes de volver a entrar.'
                    : 'Ya existe una salida registrada. Debes marcar entrada antes de volver a salir.');
            }

            if (!ultimoMarcaje && tipo === 'SALIDA') {
                throw new Error('Primero debes marcar entrada antes de registrar salida.');
            }

            const ahora = new Date();

            if (empleado) {
                const medioIdentificacion = empleadoPorCarnet ? 'CARNET' : 'CEDULA';
                const observacionBase = medioIdentificacion === 'CEDULA'
                    ? (tipo === 'ENTRADA' ? 'Ingreso sin carnet' : 'Salida sin carnet')
                    : '';
                const observacion = composeObservation(observacionBase, observacionManual);

                state.asistencias.unshift({
                    fecha: formatDate(ahora),
                    hora: formatTime(ahora),
                    tipo_registro: 'EMPLEADO',
                    cedula: empleado.cedula,
                    carnet: empleado.carnet,
                    medio_identificacion: medioIdentificacion,
                    observacion,
                    departamento_buscado: '',
                    persona_buscada: '',
                    tipo
                });
            } else {
                if (!/^[0-9A-Z-]{4,20}$/.test(identificador)) {
                    throw new Error('La cedula del invitado es invalida.');
                }

                if (tipo === 'ENTRADA' && (!departamentoBuscado || !personaBuscada)) {
                    throw new Error('Para un invitado debes indicar el departamento y la persona que busca.');
                }

                if (tipo === 'ENTRADA') {
                    const personaRegistrada = state.empleados.find((emp) => emp.cedula === personaBuscada);

                    if (!personaRegistrada) {
                        throw new Error('La persona seleccionada no esta registrada en la base de datos.');
                    }

                    if (personaRegistrada.departamento !== departamentoBuscado) {
                        throw new Error('La persona seleccionada no pertenece a ese departamento.');
                    }
                }

                const observacionBase = tipo === 'ENTRADA' ? 'Ingreso de invitado' : 'Salida de invitado';
                const observacionInvitado = composeObservation(observacionBase, observacionManual);

                state.asistencias.unshift({
                    fecha: formatDate(ahora),
                    hora: formatTime(ahora),
                    tipo_registro: 'INVITADO',
                    cedula: identificador,
                    carnet: 'INVITADO',
                    medio_identificacion: 'INVITADO',
                    observacion: observacionInvitado,
                    departamento_buscado: tipo === 'ENTRADA' ? departamentoBuscado : '',
                    persona_buscada: tipo === 'ENTRADA' ? personaBuscada : '',
                    persona_buscada_nombre: tipo === 'ENTRADA' ? personaBuscadaNombre : '',
                    tipo
                });
            }

            persistData();
            feedback.textContent = empleado
                ? `Marcacion ${tipo} registrada para ${empleado.nombre}${empleadoPorCedula ? ' (sin carnet)' : ''}.`
                : `${tipo === 'ENTRADA' ? 'Entrada' : 'Salida'} de invitado registrada con cedula ${identificador}.`;
        }

        identificadorInput.value = '';
        if (empleadoInfo) {
            empleadoInfo.classList.add('hidden');
        }
        if (empleadoNombre) {
            empleadoNombre.textContent = '-';
        }
        if (empleadoDepartamento) {
            empleadoDepartamento.textContent = '-';
        }
        if (departamentoInput) {
            departamentoInput.value = '';
        }
        if (personaInput) {
            personaInput.value = '';
        }
        if (observacionSelect) {
            observacionSelect.value = '';
        }
        if (observacionOtro) {
            observacionOtro.value = '';
            observacionOtro.classList.add('hidden');
        }
        updateGuestFieldsVisibility();
        feedback.className = 'feedback ok';
        renderAll();
    } catch (error) {
        feedback.textContent = error.message;
        feedback.className = 'feedback error';
    }
}

function showScreen(screenId) {
    // comprobar permisos de pantalla por rol
    if (!isScreenAllowedForRole(screenId, state.session.role)) {
        const fallback = getDefaultScreenForRole(state.session.role);
        state.session.activeScreen = fallback;
    } else {
        state.session.activeScreen = screenId;
    }

    Object.values(el.screens).forEach((screen) => {
        screen.classList.add('hidden');
    });

    const target = document.getElementById(screenId);
    if (target) {
        target.classList.remove('hidden');
    }

    document.querySelectorAll('.menu button').forEach((btn) => {
        const isActive = btn.dataset.screen === screenId;
        btn.classList.toggle('active', isActive);
    });
}

function renderMenu() {
    const role = state.session.role;
    const items = APP_CONFIG.menu.filter((item) => isScreenAllowedForRole(item.id, role));

    el.menu.innerHTML = items
        .map((item) => `<button type="button" data-screen="${item.id}">${item.label}</button>`)
        .join('');

    el.menu.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
            // impedir acceso a pantallas no permitidas
            if (!isScreenAllowedForRole(button.dataset.screen, state.session.role)) {
                const fallback = getDefaultScreenForRole(state.session.role);
                showScreen(fallback);
                return;
            }
            showScreen(button.dataset.screen);
        });
    });
}

function renderAll() {
    el.header.classList.toggle('hidden', !state.session.logged);

    if (!state.session.logged) {
        showScreen('screen-login');
        return;
    }

    if (state.session.activeScreen === 'screen-login') {
        state.session.activeScreen = DEFAULT_SCREEN_AFTER_LOGIN;
    }

    fillGuestPersonSelect();
    showScreen(state.session.activeScreen);
    renderDashboard();
    renderTablaEmpleados();
    renderTablaAsistencia();
    renderArchivo();
    syncReportPreviewEmptyState();
}

function renderDashboard() {
    const localMetricas = buildLocalMetrics();
    const metricas = useRemoteBackend() ? state.metricas : localMetricas;
    const asistenciasHoy = getActiveAttendanceRows();
    const empleadosVacaciones = Number(metricas.personal_vacaciones) || 0;
    const empleadosSuspendidos = Number(metricas.personal_suspendido) || 0;
    const invitadosHoy = asistenciasHoy.filter(
        (registro) => (registro.tipo_registro || 'EMPLEADO') === 'INVITADO' && registro.tipo === 'ENTRADA'
    ).length;

    syncDashboardDateFilter();

    const blocks = [
        {
            label: 'Personal activo',
            value: metricas.personal_activo,
            accent: '#173f73'
        },
        {
            label: 'Entradas hoy',
            value: metricas.entradas_hoy,
            accent: '#177f4b'
        },
        {
            label: 'Salidas hoy',
            value: metricas.salidas_hoy,
            accent: '#d3202f'
        },
        {
            label: 'Marcaciones hoy',
            value: metricas.marcaciones_hoy,
            accent: '#2a6bc8'
        },
        {
            label: 'Invitados hoy',
            value: invitadosHoy,
            accent: '#d68a00'
        },
        {
            label: 'Personal en vacaciones',
            value: empleadosVacaciones,
            accent: '#7b4dc7'
        },
        {
            label: 'Personal suspendido',
            value: empleadosSuspendidos,
            accent: '#6b7280'
        }
    ];

    document.getElementById('metricas-dashboard').innerHTML = blocks
        .map(
            (metrica) => `
                <article class="metric" style="--metric-accent:${metrica.accent};">
                    <p>${metrica.label}</p>
                    <h3>${metrica.value}</h3>
                </article>`
        )
        .join('');

    renderDashboardDonut();
    renderDashboardEarlyArrivalDonuts();
    renderDashboardChart(metricas, invitadosHoy);
    renderDashboardWeeklyChart();
    renderDashboardMovimientos();
}

function syncDashboardDateFilter() {
    const dashboardFecha = document.getElementById('dashboard-fecha');
    if (dashboardFecha && !dashboardFecha.value) {
        dashboardFecha.value = getLocalDateInputValue(new Date());
    }
}

function syncDashboardFilterOptions() {
    const dashboardEmpleado = document.getElementById('dashboard-filtro-empleado');
    const dashboardDepartamento = document.getElementById('dashboard-filtro-departamento');

    if (dashboardEmpleado) {
        const currentValue = dashboardEmpleado.value;
        dashboardEmpleado.innerHTML = [
            '<option value="">Todos los empleados</option>',
            ...state.empleados
                .slice()
                .sort((left, right) => String(left.nombre || '').localeCompare(String(right.nombre || ''), 'es'))
                .map((emp) => `<option value="${escapeHtml(emp.cedula)}">${escapeHtml(emp.nombre)} - ${escapeHtml(emp.departamento)}</option>`)
        ].join('');

        if (currentValue) {
            dashboardEmpleado.value = currentValue;
        }
    }

    if (dashboardDepartamento) {
        const currentValue = dashboardDepartamento.value;
        dashboardDepartamento.innerHTML = [
            '<option value="">Todos los departamentos</option>',
            ...APP_CONFIG.departamentos.map((departamento) => `<option value="${escapeHtml(departamento)}">${escapeHtml(departamento)}</option>`)
        ].join('');

        if (currentValue) {
            dashboardDepartamento.value = currentValue;
        }
    }
}

function getDashboardFilters() {
    const dashboardEmpleado = document.getElementById('dashboard-filtro-empleado');
    const dashboardDepartamento = document.getElementById('dashboard-filtro-departamento');

    return {
        empleadoCedula: String(dashboardEmpleado?.value || '').trim().toUpperCase(),
        departamento: String(dashboardDepartamento?.value || '').trim()
    };
}

function findAttendanceEmployee(registro) {
    const tipoRegistro = String(registro.tipo_registro || 'EMPLEADO').toUpperCase();

    if (tipoRegistro !== 'EMPLEADO') {
        return null;
    }

    return state.empleados.find(
        (emp) => String(emp.cedula || '').toUpperCase() === String(registro.cedula || '').toUpperCase()
            || String(emp.carnet || '').toUpperCase() === String(registro.carnet || '').toUpperCase()
    ) || null;
}

function getDashboardDateKey() {
    const dashboardFecha = document.getElementById('dashboard-fecha');
    const value = dashboardFecha?.value || getLocalDateInputValue(new Date());
    return normalizeAttendanceDateKey(value);
}

function getDashboardEntriesForSelectedDate() {
    const dateKey = getDashboardDateKey();
    const filters = getDashboardFilters();
    return getAllAttendanceRows().filter((registro) => {
        const isEntry = String(registro.tipo || '').toUpperCase() === 'ENTRADA';
        if (!isEntry || normalizeAttendanceDateKey(registro.fecha) !== dateKey) {
            return false;
        }

        if (filters.empleadoCedula || filters.departamento) {
            const empleado = findAttendanceEmployee(registro);

            if (filters.empleadoCedula && (!empleado || String(empleado.cedula || '').toUpperCase() !== filters.empleadoCedula)) {
                return false;
            }

            if (filters.departamento && (!empleado || String(empleado.departamento || '') !== filters.departamento)) {
                return false;
            }
        }

        return true;
    });
}

function renderDashboardDonut() {
    const container = document.getElementById('dashboard-donut');
    const summary = document.getElementById('dashboard-entry-summary');

    if (!container || !summary) {
        return;
    }

    const entries = getDashboardEntriesForSelectedDate();
    const stats = buildDashboardEntryStats(entries);
    const total = stats.total || 0;

    const carnetPercent = total ? (stats.carnet / total) * 100 : 0;
    const cedulaPercent = total ? (stats.cedula / total) * 100 : 0;
    const invitadoPercent = total ? (stats.invitado / total) * 100 : 0;

    const segments = total
        ? [
            `#177f4b 0 ${carnetPercent}%`,
            `#2a6bc8 ${carnetPercent}% ${carnetPercent + cedulaPercent}%`,
            `#d68a00 ${carnetPercent + cedulaPercent}% 100%`
        ].join(', ')
        : '#d9e6f8 0 100%';

    container.innerHTML = `
        <div class="dashboard-donut-shell" style="--segments:${segments};">
            <div class="dashboard-donut-hole">
                <div>
                    <strong>${total}</strong>
                    <span>Entradas</span>
                </div>
            </div>
        </div>`;

    summary.innerHTML = [
        { label: 'Total entradas', value: total, percent: '100%', accent: 'total' },
        { label: 'Con carnet', value: stats.carnet, percent: `${Math.round(carnetPercent)}%`, accent: 'carnet' },
        { label: 'Con cédula', value: stats.cedula, percent: `${Math.round(cedulaPercent)}%`, accent: 'cedula' },
        { label: 'Invitados', value: stats.invitado, percent: `${Math.round(invitadoPercent)}%`, accent: 'invitado' }
    ]
        .map((item) => `
            <article class="dashboard-summary-item">
                <div>
                    <strong>${escapeHtml(item.label)}</strong>
                    <small>${escapeHtml(item.value)} registro${item.value === 1 ? '' : 's'}</small>
                </div>
                <span class="dashboard-summary-pill ${item.accent}">${escapeHtml(item.percent)}</span>
            </article>`)
        .join('');
}

function renderDashboardEarlyArrivalDonuts() {
    renderEarlyArrivalDonut(
        'dashboard-early-employee',
        'dashboard-early-employee-meta',
        getDashboardEntriesForEmployeeScope(),
        'Empleado'
    );

    renderEarlyArrivalDonut(
        'dashboard-early-department',
        'dashboard-early-department-meta',
        getDashboardEntriesForDepartmentScope(),
        'Departamento'
    );
}

function getDashboardEntriesForEmployeeScope() {
    const dateKey = getDashboardDateKey();
    const filters = getDashboardFilters();

    return getAllAttendanceRows().filter((registro) => {
        const isEntry = String(registro.tipo || '').toUpperCase() === 'ENTRADA';
        if (!isEntry || normalizeAttendanceDateKey(registro.fecha) !== dateKey) {
            return false;
        }

        if (!filters.empleadoCedula) {
            return String(registro.tipo_registro || 'EMPLEADO').toUpperCase() === 'EMPLEADO';
        }

        const empleado = findAttendanceEmployee(registro);
        return Boolean(empleado) && String(empleado.cedula || '').toUpperCase() === filters.empleadoCedula;
    });
}

function getDashboardEntriesForDepartmentScope() {
    const dateKey = getDashboardDateKey();
    const filters = getDashboardFilters();

    return getAllAttendanceRows().filter((registro) => {
        const isEntry = String(registro.tipo || '').toUpperCase() === 'ENTRADA';
        if (!isEntry || normalizeAttendanceDateKey(registro.fecha) !== dateKey) {
            return false;
        }

        if (!filters.departamento) {
            return String(registro.tipo_registro || 'EMPLEADO').toUpperCase() === 'EMPLEADO';
        }

        const empleado = findAttendanceEmployee(registro);
        return Boolean(empleado) && String(empleado.departamento || '') === filters.departamento;
    });
}

function renderEarlyArrivalDonut(containerId, metaId, entries, scopeLabel) {
    const container = document.getElementById(containerId);
    const meta = document.getElementById(metaId);

    if (!container || !meta) {
        return;
    }

    const stats = buildEarlyArrivalStats(entries);
    const total = stats.total;
    const earlyPercent = total ? (stats.early / total) * 100 : 0;
    const latePercent = total ? 100 - earlyPercent : 0;

    const segments = total
        ? [
            `#177f4b 0 ${earlyPercent}%`,
            `#d3202f ${earlyPercent}% 100%`
        ].join(', ')
        : '#d9e6f8 0 100%';

    container.innerHTML = `
        <div class="dashboard-donut-shell dashboard-donut-shell-early" style="--segments:${segments};">
            <div class="dashboard-donut-hole">
                <div>
                    <strong>${Math.round(earlyPercent)}%</strong>
                    <span>Tempranas</span>
                </div>
            </div>
        </div>`;

    const dashboardEmpleado = document.getElementById('dashboard-filtro-empleado');
    const dashboardDepartamento = document.getElementById('dashboard-filtro-departamento');
    const empleadoLabel = dashboardEmpleado?.selectedOptions?.[0]?.textContent || 'Todos los empleados';
    const departamentoLabel = dashboardDepartamento?.selectedOptions?.[0]?.textContent || 'Todos los departamentos';

    meta.textContent = total
        ? `${stats.early} tempranas de ${total} entradas. ${latePercent ? `${Math.round(latePercent)}% no tempranas.` : 'Todas fueron tempranas.'} ${scopeLabel}. Filtro: ${empleadoLabel} / ${departamentoLabel}.`
        : `Sin entradas para ${scopeLabel.toLowerCase()}. Filtro: ${empleadoLabel} / ${departamentoLabel}.`;
}

function buildEarlyArrivalStats(entries) {
    const stats = {
        total: 0,
        early: 0
    };

    entries.forEach((registro) => {
        const parsed = parseAttendanceDateTime(registro.fecha, registro.hora);
        if (!parsed) {
            return;
        }

        stats.total += 1;

        const scheduleStart = buildDateWithTime(parsed, 8, 0, 0);
        if (parsed < scheduleStart) {
            stats.early += 1;
        }
    });

    return stats;
}

function buildDashboardEntryStats(entries) {
    const stats = {
        total: 0,
        carnet: 0,
        cedula: 0,
        invitado: 0
    };

    entries.forEach((registro) => {
        stats.total += 1;

        const tipoRegistro = String(registro.tipo_registro || 'EMPLEADO').toUpperCase();
        if (tipoRegistro === 'INVITADO') {
            stats.invitado += 1;
            return;
        }

        const medio = String(registro.medio_identificacion || '').toUpperCase();
        if (medio === 'CARNET') {
            stats.carnet += 1;
        } else if (medio === 'CEDULA') {
            stats.cedula += 1;
        }
    });

    return stats;
}

function renderDashboardWeeklyChart() {
    const chart = document.getElementById('dashboard-chart-weekly');
    if (!chart) {
        return;
    }

    const trend = buildLast7DaysTrend();
    const maxValue = Math.max(1, ...trend.flatMap((item) => [item.entradas, item.salidas, item.invitados]));

    chart.innerHTML = trend
        .map((item) => {
            const entradasHeight = Math.max(6, Math.round((item.entradas / maxValue) * 72));
            const salidasHeight = Math.max(6, Math.round((item.salidas / maxValue) * 72));
            const invitadosHeight = Math.max(6, Math.round((item.invitados / maxValue) * 72));

            return `
                <article class="week-day">
                    <div class="week-bars-pair">
                        <span class="week-bar week-bar-entrada" style="height:${entradasHeight}px" title="Entradas: ${item.entradas}"></span>
                        <span class="week-bar week-bar-salida" style="height:${salidasHeight}px" title="Salidas: ${item.salidas}"></span>
                        <span class="week-bar week-bar-invitado" style="height:${invitadosHeight}px" title="Invitados: ${item.invitados}"></span>
                    </div>
                    <small>${escapeHtml(item.label)}</small>
                </article>`;
        })
        .join('');
}

function buildLast7DaysTrend() {
    const days = [];

    for (let i = 6; i >= 0; i -= 1) {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - i);

        days.push({
            key: formatDate(date),
            label: date.toLocaleDateString('es-VE', { weekday: 'short' }),
            entradas: 0,
            salidas: 0,
            invitados: 0
        });
    }

    const map = new Map(days.map((day) => [day.key, day]));

    getAllAttendanceRows().forEach((registro) => {
        const item = map.get(registro.fecha);
        if (!item) {
            return;
        }

        if (registro.tipo === 'ENTRADA') {
            item.entradas += 1;
        }

        if (registro.tipo === 'SALIDA') {
            item.salidas += 1;
        }

        if ((registro.tipo_registro || 'EMPLEADO') === 'INVITADO') {
            item.invitados += 1;
        }
    });

    return days;
}

function renderDashboardChart(metricas, invitadosHoy) {
    const chart = document.getElementById('dashboard-chart');
    if (!chart) {
        return;
    }

    const bars = [
        { label: 'Entradas', value: Number(metricas.entradas_hoy) || 0, color: '#177f4b' },
        { label: 'Salidas', value: Number(metricas.salidas_hoy) || 0, color: '#d3202f' },
        { label: 'Invitados', value: Number(invitadosHoy) || 0, color: '#d68a00' }
    ];

    const maxValue = Math.max(1, ...bars.map((bar) => bar.value));

    chart.innerHTML = bars
        .map((bar) => {
            const width = Math.round((bar.value / maxValue) * 100);

            return `
                <article class="chart-row">
                    <div class="chart-meta">
                        <strong>${escapeHtml(bar.label)}</strong>
                        <span>${bar.value}</span>
                    </div>
                    <div class="chart-track">
                        <div class="chart-fill" style="width:${width}%; background:${bar.color};"></div>
                    </div>
                </article>`;
        })
        .join('');
}

function renderDashboardMovimientos() {
    const entradasEl = document.getElementById('dashboard-entradas');
    const salidasEl = document.getElementById('dashboard-salidas');

    if (!entradasEl || !salidasEl) {
        return;
    }

    const entradas = getActiveAttendanceRows().filter((registro) => registro.tipo === 'ENTRADA').slice(0, 8);
    const salidas = getActiveAttendanceRows().filter((registro) => registro.tipo === 'SALIDA').slice(0, 8);

    entradasEl.innerHTML = buildDashboardListItems(entradas, 'No hay entradas recientes.');
    salidasEl.innerHTML = buildDashboardListItems(salidas, 'No hay salidas recientes.');
}

function buildDashboardListItems(registros, emptyMessage) {
    if (!registros.length) {
        return `<li class="dashboard-item empty">${escapeHtml(emptyMessage)}</li>`;
    }

    return registros
        .map((registro) => {
            const tipoRegistro = registro.tipo_registro || 'EMPLEADO';
            const persona = tipoRegistro === 'INVITADO'
                ? `Invitado ${registro.cedula || '-'}`
                : `Carnet ${registro.carnet || '-'} / Cedula ${registro.cedula || '-'}`;
            const detail = registro.observacion || registro.medio_identificacion || tipoRegistro;
            const badgeClass = tipoRegistro === 'INVITADO' ? 'badge-guest' : (registro.medio_identificacion === 'CEDULA' ? 'badge-id' : 'badge-employee');

            return `
                <li class="dashboard-item">
                    <div>
                        <strong>${escapeHtml(persona)}</strong>
                        <span class="${badgeClass}">${escapeHtml(detail)}</span>
                    </div>
                    <small>${escapeHtml(registro.fecha || '-')} ${escapeHtml(registro.hora || '-')}</small>
                </li>`;
        })
        .join('');
}

function renderTablaEmpleados() {
    const tbody = document.getElementById('tabla-empleados');

    function formatEmployeeName(name) {
        const raw = String(name || '').trim();
        if (!raw) return '-';
        const parts = raw.split(/\s+/);
        if (parts.length <= 2) {
            return escapeHtml(raw);
        }
        // force break after first two words
        const first = parts.slice(0, 2).join(' ');
        const rest = parts.slice(2).join(' ');
        return escapeHtml(first) + '<br>' + escapeHtml(rest);
    }

    const filtroEstadoSelect = document.getElementById('filtro-estado-empleados');
    const filtroNombreInput = document.getElementById('filtro-nombre-empleados');
    const filtroDepartamentoSelect = document.getElementById('filtro-departamento-empleados');

    const filtroEstado = filtroEstadoSelect ? String(filtroEstadoSelect.value || '').trim().toUpperCase() : '';
    const filtroNombre = filtroNombreInput ? String(filtroNombreInput.value || '').trim().toUpperCase() : '';
    const filtroDepartamento = filtroDepartamentoSelect ? String(filtroDepartamentoSelect.value || '').trim().toUpperCase() : '';

    const lista = state.empleados.filter((e) => {
        const estadoOk = !filtroEstado || String(e.estado || '').toUpperCase() === filtroEstado;
        const nombreOk = !filtroNombre || String(e.nombre || '').toUpperCase().includes(filtroNombre);
        const departamentoOk = !filtroDepartamento || String(e.departamento || '').toUpperCase() === filtroDepartamento;
        return estadoOk && nombreOk && departamentoOk;
    });

    if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="7">No hay empleados registrados.</td></tr>';
        return;
    }

    tbody.innerHTML = lista
        .map(
            (emp) => `
                <tr>
                    <td>${escapeHtml(emp.cedula)}</td>
                    <td>${escapeHtml(emp.carnet || '-')}</td>
                    <td>${formatEmployeeName(emp.nombre)}</td>
                    <td>${escapeHtml(emp.departamento)}</td>
                    <td>${escapeHtml(emp.cargo)}</td>
                    <td><span class="estado-badge estado-${String((emp.estado || 'ACTIVO')).toLowerCase().replace(/[^a-z0-9]+/g, '-')}">${escapeHtml(emp.estado || 'ACTIVO')}</span></td>
                    <td>
                        <button class="btn btn-primary" data-edit-cedula="${escapeHtml(emp.cedula)}" type="button">
                            Modificar
                        </button>
                        <button class="btn btn-ghost" data-delete-cedula="${escapeHtml(emp.cedula)}" type="button">
                            Eliminar
                        </button>
                    </td>
                </tr>`
        )
        .join('');

    tbody.querySelectorAll('[data-edit-cedula]').forEach((btn) => {
        btn.addEventListener('click', () => {
            iniciarEdicionEmpleado(btn.dataset.editCedula);
        });
    });

    tbody.querySelectorAll('[data-delete-cedula]').forEach((btn) => {
        btn.addEventListener('click', () => {
            eliminarEmpleado(btn.dataset.deleteCedula);
        });
    });
}

function renderTablaAsistencia() {
    const tbody = document.getElementById('tabla-asistencia');
    const registrosHoy = getActiveAttendanceRows();

    if (!registrosHoy.length) {
        tbody.innerHTML = '<tr><td colspan="12">No hay marcaciones registradas hoy.</td></tr>';
        return;
    }

    tbody.innerHTML = registrosHoy
        .map(
            (registro) => {
                const detalleEmpleado = resolveAttendanceEmployeeDetails(registro);

                return `
                <tr>
                    <td>${escapeHtml(registro.fecha)}</td>
                    <td>${escapeHtml(registro.hora)}</td>
                    <td>${escapeHtml(registro.tipo_registro || 'EMPLEADO')}</td>
                    <td>${escapeHtml(detalleEmpleado.nombre)}</td>
                    <td>${escapeHtml(detalleEmpleado.departamento)}</td>
                    <td>${escapeHtml(registro.cedula || registro.cedula_invitado || '-')}</td>
                    <td>${escapeHtml(registro.carnet || 'INVITADO')}</td>
                    <td>${escapeHtml(registro.medio_identificacion || '-')}</td>
                    <td>${escapeHtml(registro.tipo)}</td>
                    <td>${escapeHtml(registro.observacion || '-')}</td>
                        <td>${escapeHtml(registro.departamento_buscado || '-')}</td>
                            <td>${escapeHtml(registro.persona_buscada_nombre ? (registro.persona_buscada_nombre + ' (' + (registro.persona_buscada || '-') + ')') : (registro.persona_buscada || '-'))}</td>
                </tr>`
            }
        )
        .join('');
}

function renderArchivo() {
    const resumen = document.getElementById('archivo-resumen');
    const tbody = document.getElementById('tabla-archivo');
    const summaryIndex = buildAttendanceWorkSummaries(state.asistenciasArchivadas);

    if (resumen) {
        const archivados = state.asistenciasArchivadas.length;
        const activos = getActiveAttendanceRows().length;
        const ultimaFecha = archivados ? state.asistenciasArchivadas[0]?.fecha || '--' : '--';

        resumen.innerHTML = [
            { label: 'Marcaciones activas', value: activos, accent: '#2a6bc8' },
            { label: 'Registros archivados', value: archivados, accent: '#d3202f' },
            { label: 'Ultimo archivo', value: ultimaFecha, accent: '#177f4b' }
        ]
            .map(
                (item) => `
                    <article class="archive-stat" style="--archive-accent:${item.accent};">
                        <span>${escapeHtml(item.label)}</span>
                        <strong>${escapeHtml(item.value)}</strong>
                    </article>`
            )
            .join('');
    }

    if (!tbody) {
        return;
    }

    if (!state.asistenciasArchivadas.length) {
        tbody.innerHTML = '<tr><td colspan="16">El archivo se llenara automaticamente cuando finalice el dia.</td></tr>';
        return;
    }

    tbody.innerHTML = state.asistenciasArchivadas
        .map(
            (registro) => {
                const detalleEmpleado = resolveAttendanceEmployeeDetails(registro);
                const resumenTrabajo = getAttendanceWorkSummary(registro, summaryIndex);

                return `
                <tr>
                    <td>${escapeHtml(registro.fecha)}</td>
                    <td>${escapeHtml(registro.hora)}</td>
                    <td>${escapeHtml(registro.tipo_registro || 'EMPLEADO')}</td>
                    <td>${escapeHtml(detalleEmpleado.nombre)}</td>
                    <td>${escapeHtml(detalleEmpleado.departamento)}</td>
                    <td>${escapeHtml(registro.cedula || registro.cedula_invitado || '-')}</td>
                    <td>${escapeHtml(registro.carnet || 'INVITADO')}</td>
                    <td>${escapeHtml(registro.medio_identificacion || '-')}</td>
                    <td>${escapeHtml(registro.tipo)}</td>
                    <td>${escapeHtml(registro.observacion || '-')}</td>
                        <td>${escapeHtml(registro.departamento_buscado || '-')}</td>
                        <td>${escapeHtml(registro.persona_buscada_nombre ? (registro.persona_buscada_nombre + ' (' + (registro.persona_buscada || '-') + ')') : (registro.persona_buscada || '-'))}</td>
                    <td>${escapeHtml(resumenTrabajo.horasTrabajadas)}</td>
                    <td>${escapeHtml(resumenTrabajo.tiempoTarde)}</td>
                    <td>${escapeHtml(resumenTrabajo.horasExtra)}</td>
                    <td>${escapeHtml(registro.archivado_en || '--')}</td>
                </tr>`
            }
        )
        .join('');
}

async function eliminarEmpleado(cedula) {
    try {
        if (useRemoteBackend()) {
            const payload = await apiRequest('employee_delete', 'POST', { cedula });
            applyBootstrapData(payload.data);
            state.backendOnline = true;
        } else {
            state.empleados = state.empleados.filter((emp) => emp.cedula !== cedula);
            state.asistencias = state.asistencias.filter((registro) => registro.cedula !== cedula);
            persistData();
        }

        if (state.editingEmpleadoCedula === cedula) {
            resetEmpleadoForm();
        }

        renderAll();
    } catch (error) {
        const feedback = document.getElementById('empleado-feedback');
        feedback.textContent = error.message;
        feedback.className = 'feedback error';
    }
}

function iniciarEdicionEmpleado(cedula) {
    const empleado = state.empleados.find((emp) => emp.cedula === cedula);
    if (!empleado) {
        return;
    }

    const form = document.getElementById('form-empleado');
    form.elements.originalCedula.value = empleado.cedula;
    form.elements.nombre.value = empleado.nombre;
    form.elements.cedula.value = empleado.cedula;
    form.elements.carnet.value = empleado.carnet || '';
    form.elements.departamento.value = empleado.departamento;
    form.elements.cargo.value = empleado.cargo;
    if (form.elements.estado) {
        form.elements.estado.value = empleado.estado || 'ACTIVO';
    }

    state.editingEmpleadoCedula = empleado.cedula;
    updateEmpleadoFormMode();

    const feedback = document.getElementById('empleado-feedback');
    feedback.textContent = `Editando empleado ${empleado.nombre}.`;
    feedback.className = 'feedback';
}

function resetEmpleadoForm() {
    const form = document.getElementById('form-empleado');
    form.reset();
    form.elements.originalCedula.value = '';
    state.editingEmpleadoCedula = null;
    updateEmpleadoFormMode();
}

function updateEmpleadoFormMode() {
    const btnGuardar = document.getElementById('btn-guardar-empleado');
    const btnCancelar = document.getElementById('btn-cancelar-edicion-empleado');
    const isEditing = Boolean(state.editingEmpleadoCedula);

    btnGuardar.textContent = isEditing ? 'Actualizar' : 'Guardar';
    btnCancelar.classList.toggle('hidden', !isEditing);
}

function renderReportPreview(tipo) {
    syncReportFiltersFromUI();
    const report = buildReportDataset(tipo);
    state.reporte = report;

    const titulo = document.getElementById('reporte-preview-titulo');
    const subtitulo = document.getElementById('reporte-preview-subtitulo');
    const meta = document.getElementById('reporte-preview-meta');
    const nombre = document.getElementById('reporte-activo-nombre');
    const total = document.getElementById('reporte-activo-total');
    const fecha = document.getElementById('reporte-activo-fecha');
    const thead = document.getElementById('reporte-preview-head');
    const tbody = document.getElementById('reporte-preview-body');
    const resumenShell = document.getElementById('reporte-resumen-shell');
    const resumenMeta = document.getElementById('reporte-resumen-meta');
    const resumenHead = document.getElementById('reporte-resumen-head');
    const resumenBody = document.getElementById('reporte-resumen-body');

    if (titulo) {
        titulo.textContent = report.title;
    }

    if (subtitulo) {
        subtitulo.textContent = report.subtitle;
    }

    if (meta) {
        meta.textContent = `${Math.min(12, report.rows.length)} filas visibles`;
    }

    if (nombre) {
        nombre.textContent = report.title;
    }

    if (total) {
        total.textContent = String(report.rows.length);
    }

    if (fecha) {
        fecha.textContent = new Date().toLocaleString('es-VE');
    }

    if (thead) {
        thead.innerHTML = `<tr>${report.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>`;
    }

    if (tbody) {
        tbody.innerHTML = report.rows.length
            ? report.rows.slice(0, 12).map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${report.columns.length}">No hay datos para mostrar.</td></tr>`;
    }

    if (report.tipo === 'asistencia' && resumenShell) {
        resumenShell.classList.remove('hidden');

        if (resumenMeta) {
            resumenMeta.textContent = `${report.summaryRows.length} empleados`;
        }

        if (resumenHead) {
            resumenHead.innerHTML = `<tr>${report.summaryColumns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>`;
        }

        if (resumenBody) {
            resumenBody.innerHTML = report.summaryRows.length
                ? report.summaryRows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')
                : `<tr><td colspan="${report.summaryColumns.length}">No hay resumen para mostrar.</td></tr>`;
        }
    } else if (resumenShell) {
        resumenShell.classList.add('hidden');
    }

    setReportDownloadState(true);
}

function buildReportDataset(tipo) {
    const isEmployees = tipo === 'empleados';
    const columns = isEmployees
        ? ['Cedula', 'Carnet', 'Nombre', 'Departamento', 'Cargo']
        : ['Fecha', 'Hora', 'Registro', 'Empleado', 'Departamento empleado', 'Cedula', 'Carnet', 'Medio', 'Tipo', 'Observacion', 'Departamento buscado', 'Persona buscada', 'Horas trabajadas', 'Tardanza', 'Horas extra'];

    const asistenciaFiltrada = getFilteredAttendanceRows();
    const asistenciaTodas = getAllAttendanceRows();
    const usarFallback = !isEmployees && asistenciaFiltrada.length === 0 && asistenciaTodas.length > 0;
    const asistenciaRows = isEmployees ? [] : (usarFallback ? asistenciaTodas : asistenciaFiltrada);
    const summaryIndex = buildAttendanceWorkSummaries(asistenciaRows);
    const rows = isEmployees
        ? state.empleados.map((emp) => [emp.cedula, emp.carnet || '-', emp.nombre, emp.departamento, emp.cargo])
        : asistenciaRows.map((registro) => {
            const detalleEmpleado = resolveAttendanceEmployeeDetails(registro);
            const resumenTrabajo = getAttendanceWorkSummary(registro, summaryIndex);

            return [
                registro.fecha,
                registro.hora,
                registro.tipo_registro || 'EMPLEADO',
                detalleEmpleado.nombre,
                detalleEmpleado.departamento,
                registro.cedula || registro.cedula_invitado || '-',
                registro.carnet || 'INVITADO',
                registro.medio_identificacion || '-',
                registro.tipo,
                registro.observacion || '-',
                registro.departamento_buscado || '-',
                (registro.persona_buscada_nombre ? (registro.persona_buscada_nombre + ' (' + (registro.persona_buscada || '-') + ')') : (registro.persona_buscada || '-')),
                resumenTrabajo.horasTrabajadas,
                resumenTrabajo.tiempoTarde,
                resumenTrabajo.horasExtra
            ];
        });

    return {
        tipo,
        columns,
        rows,
        summaryColumns: isEmployees ? [] : ['Empleado', 'Cedula', 'Marcaciones', 'Horas trabajadas', 'Tardanza', 'Horas extra'],
        summaryRows: isEmployees ? [] : buildAttendanceEmployeeSummaryRows(asistenciaRows, summaryIndex),
        title: isEmployees ? 'Reporte de Empleados' : 'Reporte de Asistencia',
        subtitle: isEmployees
            ? 'Listado actual de empleados registrados en el sistema'
            : buildAsistenciaReportSubtitle(usarFallback)
    };
}

function buildAsistenciaReportSubtitle(usandoFallback = false) {
    const filters = state.reporte.filters || {};
    const fecha = filters.fecha || 'todas las fechas';
    const tipo = filters.tipo || 'TODOS';
    const tipoLabel = tipo === 'ENTRADA' ? 'solo entradas' : (tipo === 'SALIDA' ? 'solo salidas' : 'entradas y salidas');

    if (usandoFallback) {
        return `Historial de marcaciones para ${fecha}, mostrando ${tipoLabel}. No hubo coincidencias exactas, por eso se muestran todos los registros disponibles.`;
    }

    return `Historial de marcaciones para ${fecha}, mostrando ${tipoLabel}`;
}

function syncReportFiltersFromUI() {
    const fechaInput = document.getElementById('reporte-fecha-asistencia');
    const tipoInput = document.getElementById('reporte-tipo-asistencia');

    if (!state.reporte.filters) {
        state.reporte.filters = { fecha: '', tipo: 'TODOS' };
    }

    if (fechaInput && fechaInput.value) {
        state.reporte.filters.fecha = fechaInput.value;
    }

    if (tipoInput && tipoInput.value) {
        state.reporte.filters.tipo = tipoInput.value;
    }
}

function getFilteredAttendanceRows() {
    const attendanceRows = getAttendanceRowsForReportDate();
    const filters = state.reporte.filters || {};
    const tipo = filters.tipo || 'TODOS';

    return attendanceRows.filter((registro) => {
        return tipo === 'TODOS' || String(registro.tipo || '').toUpperCase() === tipo;
    });
}

function getAttendanceRowsForReportDate() {
    const filters = state.reporte.filters || {};
    const fecha = filters.fecha ? normalizeDateInput(filters.fecha) : '';

    return getAllAttendanceRows().filter((registro) => {
        const coincideFecha = !fecha || normalizeAttendanceDateKey(registro.fecha) === fecha;
        return coincideFecha;
    });
}

function normalizeDateInput(value) {
    return String(value || '').trim();
}

function getLocalDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeDateValue(value) {
    return normalizeAttendanceDateKey(value);
}

function buildAttendanceWorkSummaries(rows) {
    const grouped = new Map();

    rows.forEach((registro, index) => {
        const tipoRegistro = String(registro.tipo_registro || 'EMPLEADO').toUpperCase();
        if (tipoRegistro !== 'EMPLEADO') {
            return;
        }

        const dateKey = normalizeAttendanceDateKey(registro.fecha);
        const parsedDateTime = parseAttendanceDateTime(registro.fecha, registro.hora);
        const cedula = String(registro.cedula || '').trim().toUpperCase();

        if (!dateKey || !parsedDateTime || !cedula) {
            return;
        }

        const groupKey = `${dateKey}|${cedula}`;
        if (!grouped.has(groupKey)) {
            grouped.set(groupKey, []);
        }

        grouped.get(groupKey).push({ registro, parsedDateTime, index });
    });

    const summaries = new Map();

    grouped.forEach((items, groupKey) => {
        items.sort((left, right) => left.parsedDateTime - right.parsedDateTime || left.index - right.index);

        let totalMs = 0;
        let openEntry = null;
        let firstEntry = null;
        let lastExit = null;
        const scheduleStart = buildDateWithTime(items[0].parsedDateTime, 8, 0, 0);
        const scheduleEnd = buildDateWithTime(items[0].parsedDateTime, 17, 0, 0);

        items.forEach(({ registro, parsedDateTime }) => {
            const tipo = String(registro.tipo || '').toUpperCase();

            if (tipo === 'ENTRADA') {
                if (!firstEntry) {
                    firstEntry = parsedDateTime;
                }

                if (!openEntry) {
                    openEntry = parsedDateTime;
                }
                return;
            }

            if (tipo === 'SALIDA' && openEntry) {
                totalMs += Math.max(0, parsedDateTime - openEntry);
                lastExit = parsedDateTime;
                openEntry = null;
            }
        });

        if (openEntry) {
            totalMs += Math.max(0, scheduleEnd - openEntry);
        }

        const tardeMs = firstEntry ? Math.max(0, firstEntry - scheduleStart) : null;
        // Las horas extra se cuentan solo despues de cumplir la jornada obligatoria:
        // max(17:00, hora de entrada + 8h).
        const requiredHoursEnd = firstEntry ? new Date(firstEntry.getTime() + (8 * 60 * 60 * 1000)) : null;
        const overtimeStart = requiredHoursEnd
            ? new Date(Math.max(scheduleEnd.getTime(), requiredHoursEnd.getTime()))
            : scheduleEnd;
        const horasExtraMs = lastExit ? Math.max(0, lastExit - overtimeStart) : 0;

        summaries.set(groupKey, {
            horasTrabajadas: formatDuration(totalMs),
            tiempoTarde: tardeMs === null ? 'No aplica' : formatDuration(tardeMs),
            horasExtra: formatDuration(horasExtraMs)
        });
    });

    return summaries;
}

function resolveAttendanceEmployeeDetails(registro) {
    const tipoRegistro = String(registro.tipo_registro || 'EMPLEADO').toUpperCase();

    if (tipoRegistro === 'EMPLEADO') {
        const empleado = state.empleados.find(
            (emp) => String(emp.cedula || '').toUpperCase() === String(registro.cedula || '').toUpperCase()
                || String(emp.carnet || '').toUpperCase() === String(registro.carnet || '').toUpperCase()
        );

        if (empleado) {
            return {
                nombre: empleado.nombre || '-',
                departamento: empleado.departamento || '-'
            };
        }
    }

    if (String(registro.persona_buscada_nombre || '').trim()) {
        return {
            nombre: registro.persona_buscada_nombre || '-',
            departamento: registro.departamento_buscado || '-'
        };
    }

    return {
        nombre: '-',
        departamento: '-'
    };
}

function getAttendanceWorkSummary(registro, summaries) {
    const tipoRegistro = String(registro.tipo_registro || 'EMPLEADO').toUpperCase();

    if (tipoRegistro === 'INVITADO') {
        return {
            horasTrabajadas: 'No aplica',
            tiempoTarde: 'No aplica',
            horasExtra: 'No aplica'
        };
    }

    const dateKey = normalizeAttendanceDateKey(registro.fecha);
    const cedula = String(registro.cedula || '').trim().toUpperCase();
    const summary = summaries.get(`${dateKey}|${cedula}`);

    if (summary) {
        return summary;
    }

    return {
        horasTrabajadas: '--',
        tiempoTarde: '--',
        horasExtra: '--'
    };
}

function normalizeAttendanceDateKey(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    const parts = raw.match(/\d+/g);
    if (!parts || parts.length < 3) {
        return raw;
    }

    if (parts[0].length === 4) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }

    if (parts[2].length === 4) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }

    return raw;
}

function parseAttendanceDateTime(dateValue, timeValue) {
    const dateParts = String(dateValue || '').trim().match(/\d+/g);
    const timeParts = parseAttendanceTimeParts(timeValue);

    if (!dateParts || dateParts.length < 3 || !timeParts) {
        return null;
    }

    let year;
    let month;
    let day;

    if (dateParts[0].length === 4) {
        year = Number(dateParts[0]);
        month = Number(dateParts[1]);
        day = Number(dateParts[2]);
    } else {
        day = Number(dateParts[0]);
        month = Number(dateParts[1]);
        year = Number(dateParts[2]);
    }

    if (!year || !month || !day) {
        return null;
    }

    return new Date(year, month - 1, day, timeParts.hours, timeParts.minutes, timeParts.seconds, 0);
}

function parseAttendanceTimeParts(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) {
        return null;
    }

    const numbers = raw.match(/\d+/g);
    if (!numbers || numbers.length < 2) {
        return null;
    }

    let hours = Number(numbers[0]);
    const minutes = Number(numbers[1]);
    const seconds = Number(numbers[2] || 0);
    const compact = raw.replace(/[^a-z0-9]/g, '');
    const hasPm = compact.includes('pm');
    const hasAm = compact.includes('am');

    if (hasPm && hours < 12) {
        hours += 12;
    }

    if (hasAm && hours === 12) {
        hours = 0;
    }

    return {
        hours,
        minutes,
        seconds
    };
}

function buildDateWithTime(referenceDate, hours, minutes, seconds) {
    const date = new Date(referenceDate);
    date.setHours(hours, minutes, seconds, 0);
    return date;
}

function formatDuration(ms) {
    const totalMinutes = Math.max(0, Math.round(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (!hours && !minutes) {
        return '0 min';
    }

    if (!hours) {
        return `${minutes} min`;
    }

    return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

function downloadCurrentReport(format) {
    if (!state.reporte.tipo) {
        return;
    }
    // Exportación: solo PDF

    const jspdfRef = window.jspdf;
    if (!jspdfRef || !jspdfRef.jsPDF) {
        const tbody = document.getElementById('reporte-preview-body');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="${state.reporte.columns.length}">No se pudo cargar la libreria de PDF. Verifica tu conexion a internet.</td></tr>`;
        }
        return;
    }

    const { jsPDF } = jspdfRef;
    const isAttendanceReport = state.reporte.tipo === 'asistencia';
    // Se mantiene horizontal (landscape) para asistencia
    const doc = new jsPDF({ orientation: isAttendanceReport ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const hasAutoTable = typeof doc.autoTable === 'function';
    const marginX = isAttendanceReport ? 26 : 40;
    let y = 50;

    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(16);
    doc.text(state.reporte.title, pageWidth / 2, y, { align: 'center' });
    y += 28;
    doc.setFontSize(10);
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, pageWidth / 2, y + 10, { align: 'center' });
    y += 22;

    if (!hasAutoTable) {
        const tbody = document.getElementById('reporte-preview-body');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="${state.reporte.columns.length}">No se pudo cargar el plugin de tablas para PDF. Verifica tu conexion a internet.</td></tr>`;
        }
        return;
    }

    // --- TABLA PRINCIPAL DEL REPORTE ---
    doc.autoTable({
        head: [state.reporte.columns],
        body: state.reporte.rows,
        startY: y,
        margin: { left: marginX, right: marginX },
        horizontalPageBreak: true, // <-- ESTO EVITA QUE SE CRUCEN LOS DATOS
        horizontalPageBreakRepeat: 0,
        styles: {
            fontSize: isAttendanceReport ? 6.5 : 8, // Letra un poquito más pequeña para que rinda más
            cellPadding: isAttendanceReport ? 3 : 4,
            overflow: 'linebreak'
        },
        headStyles: {
            fillColor: [23, 63, 115],
            textColor: [255, 255, 255]
        }
        // Eliminé los columnStyles con anchos fijos que tenías, 
        // dejar que jsPDF lo calcule automáticamente es mucho mejor cuando usas horizontalPageBreak.
    });

    // --- TABLA DE RESUMEN (Si aplica) ---
    if (state.reporte.tipo === 'asistencia' && Array.isArray(state.reporte.summaryRows) && state.reporte.summaryRows.length) {
        const lastY = doc.lastAutoTable && typeof doc.lastAutoTable.finalY === 'number'
            ? doc.lastAutoTable.finalY
            : y;
        const startY = lastY + 24 > 760 ? 50 : lastY + 24;

        if (startY === 50) {
            doc.addPage();
        }

        doc.setFontSize(12);
        doc.text('Resumen total por empleado', marginX, startY - 8);

        doc.autoTable({
            head: [state.reporte.summaryColumns || []],
            body: state.reporte.summaryRows,
            startY,
            margin: { left: marginX, right: marginX },
            horizontalPageBreak: true, // <-- También aquí por si acaso
            horizontalPageBreakRepeat: 0,
            styles: {
                fontSize: isAttendanceReport ? 6.8 : 8,
                cellPadding: isAttendanceReport ? 3 : 4,
                overflow: 'linebreak'
            },
            headStyles: {
                fillColor: [42, 107, 200],
                textColor: [255, 255, 255]
            }
        });
    }

    doc.save(`${state.reporte.tipo}-${Date.now()}.pdf`);
}

function setReportDownloadState(enabled) {
    const btnPdf = document.getElementById('btn-descargar-pdf');
    if (btnPdf) {
        btnPdf.disabled = !enabled;
    }
}

function syncReportPreviewEmptyState() {
    if (state.reporte.tipo) {
        return;
    }

    const thead = document.getElementById('reporte-preview-head');
    const tbody = document.getElementById('reporte-preview-body');
    const resumenShell = document.getElementById('reporte-resumen-shell');
    const resumenHead = document.getElementById('reporte-resumen-head');
    const resumenBody = document.getElementById('reporte-resumen-body');
    const resumenMeta = document.getElementById('reporte-resumen-meta');

    setReportDownloadState(false);

    if (thead) {
        thead.innerHTML = '';
    }

    if (tbody) {
        tbody.innerHTML = '<tr><td>Selecciona un reporte para ver la vista previa.</td></tr>';
    }

    if (resumenShell) {
        resumenShell.classList.add('hidden');
    }

    if (resumenHead) {
        resumenHead.innerHTML = '';
    }

    if (resumenBody) {
        resumenBody.innerHTML = '';
    }

    if (resumenMeta) {
        resumenMeta.textContent = '0 empleados';
    }
}

function buildAttendanceEmployeeSummaryRows(attendanceRows, summaryIndex) {
    const grouped = new Map();

    attendanceRows.forEach((registro) => {
        const tipoRegistro = String(registro.tipo_registro || 'EMPLEADO').toUpperCase();
        if (tipoRegistro !== 'EMPLEADO') {
            return;
        }

        const cedula = String(registro.cedula || '').trim();
        const dateKey = normalizeAttendanceDateKey(registro.fecha);
        if (!cedula || !dateKey) {
            return;
        }

        const key = `${dateKey}|${cedula.toUpperCase()}`;
        if (!grouped.has(key)) {
            grouped.set(key, {
                cedula,
                marcaciones: 0
            });
        }

        grouped.get(key).marcaciones += 1;
    });

    return [...grouped.entries()]
        .map(([key, data]) => {
            const summary = summaryIndex.get(key);
            const empleado = state.empleados.find((emp) => String(emp.cedula || '').toUpperCase() === String(data.cedula || '').toUpperCase());
            const nombre = empleado?.nombre || `Empleado ${data.cedula}`;

            return [
                nombre,
                data.cedula,
                String(data.marcaciones),
                summary?.horasTrabajadas || '--',
                summary?.tiempoTarde || '--',
                summary?.horasExtra || '--'
            ];
        })
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'es'));
}

function toRows(data) {
    return data
        .map((columns) =>
            columns
                .map((item) => `"${String(item).replaceAll('"', '""')}"`)
                .join(',')
        )
        .join('\n');
}

function persistData() {
    saveStorage(APP_CONFIG.storageKeys.empleados, state.empleados);
    saveStorage(APP_CONFIG.storageKeys.asistencias, state.asistencias);
    saveStorage(APP_CONFIG.storageKeys.archivadas, state.asistenciasArchivadas);
    state.metricas = buildLocalMetrics();
}

function readStorage(key, fallbackValue) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) {
            return fallbackValue;
        }
        return JSON.parse(raw);
    } catch {
        return fallbackValue;
    }
}

function saveStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function updateClock() {
    const clock = document.getElementById('reloj-digital');
    if (!clock) {
        return;
    }

    clock.textContent = formatTime(new Date());
    void ensureAttendanceArchive().catch(() => { });
}

function formatDate(date) {
    return date.toLocaleDateString('es-VE');
}

function formatTime(date) {
    return date.toLocaleTimeString('es-VE');
}

function validarEmpleado(empleado) {
    if (![empleado.nombre, empleado.cedula, empleado.carnet, empleado.departamento, empleado.cargo, empleado.estado].every(Boolean)) {
        return { ok: false, message: 'Completa todos los campos requeridos.' };
    }

    if (!/^[0-9A-Za-z-]{4,20}$/.test(empleado.cedula)) {
        return { ok: false, message: 'La cedula debe tener entre 4 y 20 caracteres alfanumericos.' };
    }

    if (!/^[0-9A-Za-z-]{4,30}$/.test(empleado.carnet)) {
        return { ok: false, message: 'El carnet debe tener entre 4 y 30 caracteres alfanumericos.' };
    }

    if (empleado.nombre.length < 4) {
        return { ok: false, message: 'El nombre completo debe tener al menos 4 caracteres.' };
    }

    if (empleado.cargo.length < 2) {
        return { ok: false, message: 'El cargo es demasiado corto.' };
    }

    return { ok: true, message: '' };
}

function buildLocalMetrics() {
    const hoy = formatDate(new Date());
    const marcacionesHoy = getActiveAttendanceRows().filter((registro) => registro.fecha === hoy);
    const empleadosVacaciones = state.empleados.filter(
        (empleado) => String(empleado.estado || 'ACTIVO').toUpperCase() === 'VACACIONES'
    ).length;
    const empleadosSuspendidos = state.empleados.filter(
        (empleado) => String(empleado.estado || 'ACTIVO').toUpperCase() === 'SUSPENDIDO'
    ).length;

    return {
        personal_activo: state.empleados.length,
        personal_vacaciones: empleadosVacaciones,
        personal_suspendido: empleadosSuspendidos,
        entradas_hoy: marcacionesHoy.filter((registro) => registro.tipo === 'ENTRADA').length,
        salidas_hoy: marcacionesHoy.filter((registro) => registro.tipo === 'SALIDA').length,
        marcaciones_hoy: marcacionesHoy.length
    };
}

function composeObservation(base, manual) {
    const textoBase = String(base || '').trim();
    const textoManual = String(manual || '').trim();

    if (textoBase && textoManual) {
        return `${textoBase}. ${textoManual}`;
    }

    if (textoBase) {
        return textoBase;
    }

    if (textoManual) {
        return textoManual;
    }

    return '';
}

function updateGuestFieldsVisibility() {
    const guestFields = document.getElementById('asistencia-invitado-fields');
    const identificadorInput = document.getElementById('asistencia-identificador');
    const departamentoInput = document.getElementById('asistencia-departamento');
    const personaInput = document.getElementById('asistencia-persona');

    if (!guestFields || !identificadorInput) {
        return;
    }

    const identificador = identificadorInput.value.trim().toUpperCase();
    const empleadoPorCarnet = state.empleados.find((emp) => String(emp.carnet || '').toUpperCase() === identificador);
    const empleadoPorCedula = state.empleados.find((emp) => String(emp.cedula || '').toUpperCase() === identificador);
    const isGuest = Boolean(identificador) && !empleadoPorCarnet && !empleadoPorCedula;
    const shouldShow = state.attendanceMode === 'ENTRADA' && isGuest;

    fillGuestPersonSelect();
    guestFields.classList.toggle('hidden', !shouldShow);

    if (!shouldShow) {
        if (departamentoInput) {
            departamentoInput.value = '';
        }
        if (personaInput) {
            personaInput.value = '';
        }
    }
}

function updateAttendanceEmployeeInfo() {
    const identificadorInput = document.getElementById('asistencia-identificador');
    const empleadoInfo = document.getElementById('asistencia-empleado-info');
    const empleadoNombre = document.getElementById('asistencia-empleado-nombre');
    const empleadoDepartamento = document.getElementById('asistencia-empleado-departamento');

    if (!identificadorInput || !empleadoInfo || !empleadoNombre || !empleadoDepartamento) {
        return;
    }

    const identificador = identificadorInput.value.trim().toUpperCase();
    const empleadoPorCarnet = state.empleados.find((emp) => String(emp.carnet || '').toUpperCase() === identificador);
    const empleadoPorCedula = state.empleados.find((emp) => String(emp.cedula || '').toUpperCase() === identificador);
    const empleado = empleadoPorCarnet || empleadoPorCedula;

    if (!identificador || !empleado) {
        empleadoInfo.classList.add('hidden');
        empleadoNombre.textContent = '-';
        empleadoDepartamento.textContent = '-';
        return;
    }

    empleadoNombre.textContent = empleado.nombre || '-';
    empleadoDepartamento.textContent = empleado.departamento || '-';
    empleadoInfo.classList.remove('hidden');
}

function fillGuestPersonSelect() {
    const personaSelect = document.getElementById('asistencia-persona');
    if (!personaSelect) {
        return;
    }

    const currentValue = personaSelect.value;
    const options = ['<option value="">Selecciona la persona</option>']
        .concat(
            [...state.empleados]
                .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
                .map((emp) => `<option value="${escapeHtml(emp.cedula)}" data-nombre="${escapeHtml(emp.nombre)}">${escapeHtml(emp.nombre)} - ${escapeHtml(emp.departamento)}</option>`)
        )
        .join('');

    personaSelect.innerHTML = options;
    if (currentValue) {
        personaSelect.value = currentValue;
    }
}
function getUltimoMarcajeLocal(tipoRegistro, identificador) {
    const registrosActivos = getActiveAttendanceRows();

    if (tipoRegistro === 'EMPLEADO') {
        return registrosActivos.find(
            (registro) => (registro.tipo_registro || 'EMPLEADO') === 'EMPLEADO'
                && String(registro.cedula || '').toUpperCase() === String(identificador).toUpperCase()
        ) || null;
    }

    return registrosActivos.find(
        (registro) => (registro.tipo_registro || 'EMPLEADO') === 'INVITADO'
            && String(registro.cedula || '').toUpperCase() === String(identificador).toUpperCase()
    ) || null;
}

function getActiveAttendanceRows() {
    const today = formatDate(new Date());
    return state.asistencias.filter((registro) => registro.fecha === today);
}

function getAllAttendanceRows() {
    return [...state.asistencias, ...state.asistenciasArchivadas];
}

async function ensureAttendanceArchive(force = false) {
    const todayKey = getDayKey(new Date());

    if (!force && state.archive.lastCheckKey === todayKey) {
        return;
    }

    state.archive.lastCheckKey = todayKey;

    if (useRemoteBackend()) {
        const payload = await apiRequest('archive_sync', 'POST', {});
        applyBootstrapData(payload.data);
        state.backendOnline = true;
        return;
    }

    archiveOldAttendanceLocal();
}

function archiveOldAttendanceLocal() {
    const today = formatDate(new Date());
    const toArchive = state.asistencias.filter((registro) => registro.fecha !== today);

    if (!toArchive.length) {
        return;
    }

    state.asistenciasArchivadas = [...toArchive, ...state.asistenciasArchivadas];
    state.asistencias = state.asistencias.filter((registro) => registro.fecha === today);
    persistData();
}

function getDayKey(date) {
    return formatDate(date);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

init();
