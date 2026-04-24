const APP_CONFIG = {
    appName: 'SCA CORPOELEC',
    backend: {
        mode: 'auto',
        endpoint: 'backend/api.php'
    },
    storageKeys: {
        empleados: 'sca_empleados',
        asistencias: 'sca_asistencias'
    },
    auth: {
        username: 'admin_cabimas',
        password: '123456'
    },
    departamentos: [
        'Gerencia de Tecnologia (ASIT)',
        'Recursos Humanos',
        'Prevencion y Proteccion (PCP)',
        'Distribucion',
        'Comercial'
    ],
    menu: [
        { id: 'screen-asistencia', label: 'Asistencia' },
        { id: 'screen-dashboard', label: 'Dashboard' },
        { id: 'screen-empleados', label: 'Empleados' },
        { id: 'screen-reportes', label: 'Reportes' }
    ]
};

const state = {
    session: {
        logged: false,
        activeScreen: 'screen-login'
    },
    editingEmpleadoCedula: null,
    backendOnline: false,
    empleados: [],
    asistencias: [],
    metricas: {
        personal_activo: 0,
        entradas_hoy: 0,
        salidas_hoy: 0,
        marcaciones_hoy: 0
    }
};

const DEFAULT_SCREEN_AFTER_LOGIN = 'screen-asistencia';

const el = {
    header: document.getElementById('app-header'),
    menu: document.getElementById('menu-principal'),
    btnCerrarSesion: document.getElementById('btn-cerrar-sesion'),
    screens: {
        login: document.getElementById('screen-login'),
        dashboard: document.getElementById('screen-dashboard'),
        empleados: document.getElementById('screen-empleados'),
        asistencia: document.getElementById('screen-asistencia'),
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
            return;
        } catch {
            state.backendOnline = false;
        }
    }

    state.empleados = readStorage(APP_CONFIG.storageKeys.empleados, []);
    state.asistencias = readStorage(APP_CONFIG.storageKeys.asistencias, []);
    state.metricas = buildLocalMetrics();
}

function applyBootstrapData(data) {
    state.empleados = data.empleados || [];
    state.asistencias = data.asistencias || [];
    state.metricas = data.metricas || buildLocalMetrics();
}

function mountTemplates() {
    el.screens.login.innerHTML = getTemplate('tpl-login');
    el.screens.dashboard.innerHTML = getTemplate('tpl-dashboard');
    el.screens.empleados.innerHTML = getTemplate('tpl-empleados');
    el.screens.asistencia.innerHTML = getTemplate('tpl-asistencia');
    el.screens.reportes.innerHTML = getTemplate('tpl-reportes');

    const deptSelect = document.getElementById('departamento-select');
    deptSelect.innerHTML = APP_CONFIG.departamentos
        .map((dep) => `<option value="${dep}">${dep}</option>`)
        .join('');

    const preview = document.getElementById('reporte-preview');
    if (preview) {
        preview.textContent = 'Vista previa de exportacion: aqui veras un resumen antes de descargar el archivo.';
    }
}

function getTemplate(id) {
    const tpl = document.getElementById(id);
    return tpl ? tpl.innerHTML : '';
}

function bindGlobalEvents() {
    el.btnCerrarSesion.addEventListener('click', () => {
        state.session.logged = false;
        showScreen('screen-login');
        renderAll();
    });
}

function bindScreenEvents() {
    document.getElementById('form-login').addEventListener('submit', onLogin);
    document.getElementById('form-empleado').addEventListener('submit', onEmpleadoSubmit);
    document.getElementById('btn-cancelar-edicion-empleado').addEventListener('click', onCancelarEdicionEmpleado);
    document.getElementById('btn-limpiar-empleados').addEventListener('click', onLimpiarEmpleados);

    document
        .querySelectorAll('[data-tipo]')
        .forEach((button) => button.addEventListener('click', () => onRegistrarAsistencia(button.dataset.tipo)));

    document.getElementById('btn-exportar-empleados-excel').addEventListener('click', () => exportExcel('empleados'));
    document.getElementById('btn-exportar-asistencia-excel').addEventListener('click', () => exportExcel('asistencia'));
    document.getElementById('btn-exportar-empleados-pdf').addEventListener('click', () => exportPdf('empleados'));
    document.getElementById('btn-exportar-asistencia-pdf').addEventListener('click', () => exportPdf('asistencia'));
}

async function onLogin(event) {
    event.preventDefault();

    const user = document.getElementById('login-user').value.trim();
    const pass = document.getElementById('login-pass').value;
    const feedback = document.getElementById('login-feedback');

    try {
        if (useRemoteBackend()) {
            await apiRequest('login', 'POST', { user, pass });
        } else {
            if (user !== APP_CONFIG.auth.username || pass !== APP_CONFIG.auth.password) {
                throw new Error('Credenciales invalidas.');
            }
        }

        state.session.logged = true;
        feedback.textContent = 'Acceso correcto.';
        feedback.className = 'feedback ok';
        showScreen(DEFAULT_SCREEN_AFTER_LOGIN);
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
        cargo: String(formData.get('cargo') || '').trim()
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

async function onRegistrarAsistencia(tipo) {
    const identificadorInput = document.getElementById('asistencia-identificador');
    const feedback = document.getElementById('asistencia-feedback');
    const identificador = identificadorInput.value.trim().toUpperCase();

    if (!identificador) {
        feedback.textContent = 'Debes ingresar carnet (empleado) o cedula (invitado).';
        feedback.className = 'feedback error';
        return;
    }

    try {
        if (useRemoteBackend()) {
            const payload = await apiRequest('attendance_mark', 'POST', { identificador, tipo });
            applyBootstrapData(payload.data);
            feedback.textContent = payload.message || 'Marcacion registrada.';
            state.backendOnline = true;
        } else {
            const empleadoPorCarnet = state.empleados.find((emp) => String(emp.carnet || '').toUpperCase() === identificador);
            const empleadoPorCedula = state.empleados.find((emp) => String(emp.cedula || '').toUpperCase() === identificador);
            const empleado = empleadoPorCarnet || empleadoPorCedula;

            const ahora = new Date();

            if (empleado) {
                const medioIdentificacion = empleadoPorCarnet ? 'CARNET' : 'CEDULA';
                const observacion = medioIdentificacion === 'CEDULA'
                    ? (tipo === 'ENTRADA' ? 'Ingreso sin carnet' : 'Marcaje sin carnet')
                    : '';

                state.asistencias.unshift({
                    fecha: formatDate(ahora),
                    hora: formatTime(ahora),
                    tipo_registro: 'EMPLEADO',
                    cedula: empleado.cedula,
                    carnet: empleado.carnet,
                    medio_identificacion: medioIdentificacion,
                    observacion,
                    tipo
                });
            } else {
                if (!/^[0-9A-Z-]{4,20}$/.test(identificador)) {
                    throw new Error('La cedula del invitado es invalida.');
                }

                if (tipo !== 'ENTRADA') {
                    throw new Error('Para invitados solo se permite marcar ENTRADA con cedula.');
                }

                state.asistencias.unshift({
                    fecha: formatDate(ahora),
                    hora: formatTime(ahora),
                    tipo_registro: 'INVITADO',
                    cedula: identificador,
                    carnet: 'INVITADO',
                    medio_identificacion: 'INVITADO',
                    observacion: 'Ingreso de invitado',
                    tipo
                });
            }

            persistData();
            feedback.textContent = empleado
                ? `Marcacion ${tipo} registrada para ${empleado.nombre}${empleadoPorCedula ? ' (sin carnet)' : ''}.`
                : `Entrada de invitado registrada con cedula ${identificador}.`;
        }

        identificadorInput.value = '';
        feedback.className = 'feedback ok';
        renderAll();
    } catch (error) {
        feedback.textContent = error.message;
        feedback.className = 'feedback error';
    }
}

function showScreen(screenId) {
    state.session.activeScreen = screenId;

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
    el.menu.innerHTML = APP_CONFIG.menu
        .map(
            (item) =>
                `<button type="button" data-screen="${item.id}">${item.label}</button>`
        )
        .join('');

    el.menu.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
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

    showScreen(state.session.activeScreen);
    renderDashboard();
    renderTablaEmpleados();
    renderTablaAsistencia();
}

function renderDashboard() {
    const localMetricas = buildLocalMetrics();
    const metricas = useRemoteBackend() ? state.metricas : localMetricas;
    const asistenciasHoy = state.asistencias.filter((registro) => registro.fecha === formatDate(new Date()));
    const invitadosHoy = asistenciasHoy.filter(
        (registro) => (registro.tipo_registro || 'EMPLEADO') === 'INVITADO' && registro.tipo === 'ENTRADA'
    ).length;

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

    renderDashboardChart(metricas, invitadosHoy);
    renderDashboardWeeklyChart();
    renderDashboardMovimientos();
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

    state.asistencias.forEach((registro) => {
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

    const entradas = state.asistencias.filter((registro) => registro.tipo === 'ENTRADA').slice(0, 8);
    const salidas = state.asistencias.filter((registro) => registro.tipo === 'SALIDA').slice(0, 8);

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

    if (!state.empleados.length) {
        tbody.innerHTML = '<tr><td colspan="6">No hay empleados registrados.</td></tr>';
        return;
    }

    tbody.innerHTML = state.empleados
        .map(
            (emp) => `
                <tr>
                    <td>${escapeHtml(emp.cedula)}</td>
                    <td>${escapeHtml(emp.carnet || '-')}</td>
                    <td>${escapeHtml(emp.nombre)}</td>
                    <td>${escapeHtml(emp.departamento)}</td>
                    <td>${escapeHtml(emp.cargo)}</td>
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

    if (!state.asistencias.length) {
        tbody.innerHTML = '<tr><td colspan="8">No hay marcaciones registradas.</td></tr>';
        return;
    }

    tbody.innerHTML = state.asistencias
        .slice(0, 120)
        .map(
            (registro) => `
                <tr>
                    <td>${escapeHtml(registro.fecha)}</td>
                    <td>${escapeHtml(registro.hora)}</td>
                    <td>${escapeHtml(registro.tipo_registro || 'EMPLEADO')}</td>
                    <td>${escapeHtml(registro.cedula || '-')}</td>
                    <td>${escapeHtml(registro.carnet || 'INVITADO')}</td>
                    <td>${escapeHtml(registro.medio_identificacion || '-')}</td>
                    <td>${escapeHtml(registro.tipo)}</td>
                    <td>${escapeHtml(registro.observacion || '-')}</td>
                </tr>`
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

function exportCsv(tipo) {
    const rows =
        tipo === 'empleados'
            ? toRows([
                ['Cedula', 'Carnet', 'Nombre', 'Departamento', 'Cargo'],
                ...state.empleados.map((emp) => [emp.cedula, emp.carnet || '-', emp.nombre, emp.departamento, emp.cargo])
            ])
            : toRows([
                ['Fecha', 'Hora', 'Registro', 'Cedula', 'Carnet', 'Medio', 'Tipo', 'Observacion'],
                ...state.asistencias.map((registro) => [
                    registro.fecha,
                    registro.hora,
                    registro.tipo_registro || 'EMPLEADO',
                    registro.cedula || '-',
                    registro.carnet || 'INVITADO',
                    registro.medio_identificacion || '-',
                    registro.tipo,
                    registro.observacion || '-'
                ])
            ]);

    const preview = document.getElementById('reporte-preview');
    preview.textContent = rows;

    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tipo}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportExcel(tipo) {
    const data =
        tipo === 'empleados'
            ? [
                ['Cedula', 'Carnet', 'Nombre', 'Departamento', 'Cargo'],
                ...state.empleados.map((emp) => [emp.cedula, emp.carnet || '-', emp.nombre, emp.departamento, emp.cargo])
            ]
            : [
                ['Fecha', 'Hora', 'Registro', 'Cedula', 'Carnet', 'Medio', 'Tipo', 'Observacion'],
                ...state.asistencias.map((registro) => [
                    registro.fecha,
                    registro.hora,
                    registro.tipo_registro || 'EMPLEADO',
                    registro.cedula || '-',
                    registro.carnet || 'INVITADO',
                    registro.medio_identificacion || '-',
                    registro.tipo,
                    registro.observacion || '-'
                ])
            ];

    const rows = data
        .map((columns) => columns.map((item) => String(item).replaceAll('\t', ' ')).join('\t'))
        .join('\n');

    const preview = document.getElementById('reporte-preview');
    preview.textContent = rows;

    const blob = new Blob([rows], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tipo}-${Date.now()}.xls`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportPdf(tipo) {
    const jspdfRef = window.jspdf;
    if (!jspdfRef || !jspdfRef.jsPDF) {
        const preview = document.getElementById('reporte-preview');
        preview.textContent = 'No se pudo cargar la libreria de PDF. Verifica tu conexion a internet.';
        return;
    }

    const { jsPDF } = jspdfRef;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const marginX = 40;
    let y = 50;

    const title = tipo === 'empleados' ? 'Reporte de Empleados' : 'Reporte de Asistencia';
    const data =
        tipo === 'empleados'
            ? [
                ['Cedula', 'Carnet', 'Nombre', 'Departamento', 'Cargo'],
                ...state.empleados.map((emp) => [emp.cedula, emp.carnet || '-', emp.nombre, emp.departamento, emp.cargo])
            ]
            : [
                ['Fecha', 'Hora', 'Registro', 'Cedula', 'Carnet', 'Medio', 'Tipo', 'Observacion'],
                ...state.asistencias.map((registro) => [
                    registro.fecha,
                    registro.hora,
                    registro.tipo_registro || 'EMPLEADO',
                    registro.cedula || '-',
                    registro.carnet || 'INVITADO',
                    registro.medio_identificacion || '-',
                    registro.tipo,
                    registro.observacion || '-'
                ])
            ];

    doc.setFontSize(14);
    doc.text(title, marginX, y);
    y += 22;
    doc.setFontSize(10);
    doc.text(`Generado: ${new Date().toLocaleString('es-VE')}`, marginX, y);
    y += 18;

    data.forEach((row, index) => {
        const line = row.join(' | ');
        const wrapped = doc.splitTextToSize(line, 520);

        if (y > 780) {
            doc.addPage();
            y = 50;
        }

        if (index === 0) {
            doc.setFont(undefined, 'bold');
        } else {
            doc.setFont(undefined, 'normal');
        }

        doc.text(wrapped, marginX, y);
        y += 14 * wrapped.length;
    });

    const preview = document.getElementById('reporte-preview');
    preview.textContent = data.map((row) => row.join(' | ')).join('\n');

    doc.save(`${tipo}-${Date.now()}.pdf`);
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
}

function formatDate(date) {
    return date.toLocaleDateString('es-VE');
}

function formatTime(date) {
    return date.toLocaleTimeString('es-VE');
}

function validarEmpleado(empleado) {
    if (![empleado.nombre, empleado.cedula, empleado.carnet, empleado.departamento, empleado.cargo].every(Boolean)) {
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
    const marcacionesHoy = state.asistencias.filter((registro) => registro.fecha === hoy);

    return {
        personal_activo: state.empleados.length,
        entradas_hoy: marcacionesHoy.filter((registro) => registro.tipo === 'ENTRADA').length,
        salidas_hoy: marcacionesHoy.filter((registro) => registro.tipo === 'SALIDA').length,
        marcaciones_hoy: marcacionesHoy.length
    };
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
