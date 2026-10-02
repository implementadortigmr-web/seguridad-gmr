import { useEffect, useMemo, useRef, useState } from 'react';
import { Edit3, Plus, QrCode, Save } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import CatalogTable from '../../components/CatalogTable';
import FormModal from '../../components/admin/FormModal';
import DataLoadingState from '../../components/DataLoadingState';
import {
  guardarPersonal,
  listarPersonalPorTipo,
  listarPuestos,
} from '../../services/personasAdminService';

const EVENTUAL_EMPTY = {
  nombre: '',
  telefono: '',
  propiedadesPermitidas: [],
  area: '',
  puestoId: '',
  tarifaPersonalizada: '',
  activo: true,
};

const PRACTICANTE_EMPTY = {
  nombre: '',
  telefono: '',
  propiedadesPermitidas: [],
  school: '',
  career: '',
  area: '',
  supervisor: '',
  startDate: '',
  endDate: '',
  targetHours: '',
  initialAccumulatedHours: '0',
  activo: true,
};

function normalizar(valor = '') {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function esMexico(propiedad) {
  const texto = `${propiedad?.codigo || ''} ${propiedad?.nombre || ''}`;
  return normalizar(texto).includes('MEXICO');
}

function propiedadesDePersona(item) {
  if (Array.isArray(item?.propiedadesPermitidas) && item.propiedadesPermitidas.length) {
    return item.propiedadesPermitidas;
  }
  return item?.propiedadId ? [item.propiedadId] : [];
}

export default function PersonalPanel({ propiedades = [], setMessage, defaultTab = 'eventual' }) {
  const [tab, setTab] = useState(defaultTab);
  const [rows, setRows] = useState([]);
  const [puestos, setPuestos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(EVENTUAL_EMPTY);
  const [qrPerson, setQrPerson] = useState(null);
  const qrRef = useRef(null);

  const activeProperties = useMemo(
    () => (Array.isArray(propiedades) ? propiedades : []).filter((p) => p.activo === true),
    [propiedades]
  );

  const selectableProperties = useMemo(
    () => activeProperties.filter((p) => !esMexico(p)),
    [activeProperties]
  );

  const activeJobs = useMemo(
    () => puestos.filter((p) => p.activo !== false),
    [puestos]
  );

  const selectedJob = useMemo(
    () => activeJobs.find((p) => p.id === form.puestoId) || null,
    [activeJobs, form.puestoId]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((item) => {
      const properties = propiedadesDePersona(item);
      const propertyOk = !propertyFilter || properties.includes(propertyFilter);
      const textOk =
        !q ||
        [
          item.nombre,
          item.area,
          item.puestoNombre,
          item.school,
          item.career,
          item.supervisor,
        ].some((v) => String(v || '').toLowerCase().includes(q));

      return propertyOk && textOk;
    });
  }, [rows, search, propertyFilter]);

  function propertyName(id) {
    return activeProperties.find((p) => p.id === id)?.nombre || id || 'Sin propiedad';
  }

  function propertyNames(item) {
    const ids = propiedadesDePersona(item);
    return ids.length ? ids.map(propertyName).join(', ') : 'Sin propiedades';
  }

  async function load(type = tab) {
    setLoading(true);
    try {
      const peoplePromise = listarPersonalPorTipo(type);
      const jobsPromise = type === 'eventual'
        ? (puestos.length ? Promise.resolve(puestos) : listarPuestos())
        : Promise.resolve(puestos);

      const [people, jobs] = await Promise.all([peoplePromise, jobsPromise]);
      setRows(people);
      if (type === 'eventual') setPuestos(jobs);
    } catch (e) {
      setMessage?.(e?.message || 'No fue posible cargar personal.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function changeTab(next) {
    setTab(next);
    setSearch('');
    setPropertyFilter('');
    setEditingId('');
    setOpen(false);
    setForm(next === 'eventual' ? EVENTUAL_EMPTY : PRACTICANTE_EMPTY);
  }

  function nuevo() {
    setEditingId('');
    setForm(tab === 'eventual' ? EVENTUAL_EMPTY : PRACTICANTE_EMPTY);
    setOpen(true);
  }

  function editar(item) {
    setEditingId(item.id);
    const properties = propiedadesDePersona(item).filter((id) =>
      selectableProperties.some((p) => p.id === id)
    );

    if (tab === 'eventual') {
      setForm({
        nombre: item.nombre || '',
        telefono: item.telefono || '',
        propiedadesPermitidas: properties,
        area: item.area || '',
        puestoId: item.puestoId || '',
        tarifaPersonalizada: item.tarifaPersonalizada ?? '',
        activo: item.activo !== false,
      });
    } else {
      setForm({
        nombre: item.nombre || '',
        telefono: item.telefono || '',
        propiedadesPermitidas: properties,
        school: item.school || '',
        career: item.career || '',
        area: item.area || '',
        supervisor: item.supervisor || '',
        startDate: item.startDate || '',
        endDate: item.endDate || '',
        targetHours: String(item.targetHours ?? ''),
        initialAccumulatedHours: String(item.initialAccumulatedHours ?? 0),
        activo: item.activo !== false,
      });
    }
    setOpen(true);
  }

  function toggleProperty(id) {
    setForm((current) => {
      const selected = Array.isArray(current.propiedadesPermitidas)
        ? current.propiedadesPermitidas
        : [];
      return {
        ...current,
        propiedadesPermitidas: selected.includes(id)
          ? selected.filter((item) => item !== id)
          : [...selected, id],
      };
    });
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;

    if (!form.propiedadesPermitidas?.length) {
      setMessage?.('Selecciona al menos una propiedad.');
      return;
    }

    setBusy(true);
    setMessage?.('');

    try {
      const payload = {
        ...form,
        tipo: tab,
        empleadoId: editingId || undefined,
      };

      if (tab === 'practicante') {
        payload.targetHours = Number(form.targetHours || 0);
        payload.initialAccumulatedHours = Number(form.initialAccumulatedHours || 0);
      }

      await guardarPersonal(payload);
      setOpen(false);
      setEditingId('');
      await load(tab);
      setMessage?.(`${tab === 'eventual' ? 'Eventual' : 'Practicante'} guardado correctamente.`);
    } catch (e) {
      setMessage?.(e?.message || 'No fue posible guardar el registro.');
    } finally {
      setBusy(false);
    }
  }

  function qrSubtitle(person) {
    if (!person) return '';
    if (person.tipo === 'eventual') return person.puestoNombre || 'Eventual';
    if (person.tipo === 'practicante') {
      return [person.career || 'Practicante', person.area].filter(Boolean).join(' · ');
    }
    return person.area || 'Personal';
  }

  async function downloadQr() {
    const qrCanvas = qrRef.current?.querySelector('canvas');
    if (!qrCanvas || !qrPerson) return;

    const width = 760;
    const height = 980;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Encabezado corporativo oscuro para que el logo blanco conserve contraste.
    ctx.fillStyle = '#10283a';
    ctx.fillRect(0, 0, width, 170);

    try {
      const logo = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = '/brand/gmr-logo.png';
      });
      const maxW = 510;
      const maxH = 92;
      const scale = Math.min(maxW / logo.width, maxH / logo.height);
      const drawW = logo.width * scale;
      const drawH = logo.height * scale;
      ctx.drawImage(logo, (width - drawW) / 2, (170 - drawH) / 2, drawW, drawH);
    } catch {
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 28px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('MEXICO REAL CORPORATIVO', width / 2, 96);
    }

    const qrSize = 430;
    ctx.drawImage(qrCanvas, (width - qrSize) / 2, 205, qrSize, qrSize);

    ctx.fillStyle = '#112b3c';
    ctx.textAlign = 'center';
    ctx.font = '700 38px Arial';
    const name = String(qrPerson.nombre || 'Personal').slice(0, 42);
    ctx.fillText(name, width / 2, 700);

    ctx.fillStyle = '#1f5d75';
    ctx.font = '700 28px Arial';
    ctx.fillText(qrSubtitle(qrPerson).slice(0, 48), width / 2, 755);

    ctx.fillStyle = '#697586';
    ctx.font = '500 20px Arial';
    ctx.fillText('Presenta este código para registrar entrada y salida', width / 2, 845);

    const link = document.createElement('a');
    link.download = `${qrPerson.nombre}-credencial-qr.png`.replace(/\s+/g, '_');
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  const eventualColumns = ['Nombre', 'Propiedades', 'Puesto', 'Tarifa', 'Estado', 'Acciones'];
  const practColumns = ['Nombre', 'Propiedades', 'Escuela / Carrera', 'Horas objetivo', 'Estado', 'Acciones'];

  return (
    <section>
      <div className="catalog-toolbar">
        <div>
          <h2>Personal</h2>
          <p className="muted">
            RH administra eventuales y practicantes. Estas fichas no crean una cuenta de acceso al sistema.
          </p>
        </div>
        <button type="button" className="primary-button" onClick={nuevo}>
          <Plus size={17} />
          {tab === 'eventual' ? 'Nuevo eventual' : 'Nuevo practicante'}
        </button>
      </div>

      <div className="catalog-segmented-tabs">
        <button
          type="button"
          className={tab === 'eventual' ? 'active' : ''}
          onClick={() => changeTab('eventual')}
        >
          Eventuales
        </button>
        <button
          type="button"
          className={tab === 'practicante' ? 'active' : ''}
          onClick={() => changeTab('practicante')}
        >
          Practicantes
        </button>
      </div>

      <div className="catalog-filter-row">
        <input
          className="text-input"
          placeholder="Buscar por nombre, puesto, escuela..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="text-input"
          value={propertyFilter}
          onChange={(e) => setPropertyFilter(e.target.value)}
        >
          <option value="">Todas las propiedades</option>
          {selectableProperties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <DataLoadingState
          title={tab === 'eventual' ? 'Cargando eventuales...' : 'Cargando practicantes...'}
          detail="Consultando personal, propiedades y puestos."
        />
      ) : (
        <CatalogTable
          columns={tab === 'eventual' ? eventualColumns : practColumns}
          rows={filtered.map((item) =>
            tab === 'eventual'
              ? [
                  item.nombre,
                  propertyNames(item),
                  item.puestoNombre || 'Sin puesto',
                  `$${Number(item.tarifaPersonalizada ?? item.tarifaBase ?? 0).toFixed(2)}`,
                  item.activo !== false ? 'Activo' : 'Inactivo',
                  <div className="table-actions" key={item.id}>
                    <button type="button" className="mini-button" onClick={() => editar(item)}>
                      <Edit3 size={14} /> Editar
                    </button>
                    <button type="button" className="mini-button" onClick={() => setQrPerson(item)}>
                      <QrCode size={14} /> QR
                    </button>
                  </div>,
                ]
              : [
                  item.nombre,
                  propertyNames(item),
                  `${item.school || '-'} · ${item.career || '-'}`,
                  `${Number(item.targetHours || 0)} h`,
                  item.activo !== false ? 'Activo' : 'Inactivo',
                  <div className="table-actions" key={item.id}>
                    <button type="button" className="mini-button" onClick={() => editar(item)}>
                      <Edit3 size={14} /> Editar
                    </button>
                    <button type="button" className="mini-button" onClick={() => setQrPerson(item)}>
                      <QrCode size={14} /> QR
                    </button>
                  </div>,
                ]
          )}
        />
      )}

      <FormModal
        open={open}
        title={
          editingId
            ? `Editar ${tab === 'eventual' ? 'eventual' : 'practicante'}`
            : `Nuevo ${tab === 'eventual' ? 'eventual' : 'practicante'}`
        }
        subtitle="Completa la información del personal."
        onClose={() => !busy && setOpen(false)}
        busy={busy}
      >
        <form onSubmit={save} className="modal-form-grid">
          <label className="field-label">
            Nombre completo
            <input
              className="text-input"
              required
              maxLength={160}
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            />
          </label>

          <label className="field-label">
            Teléfono
            <input
              className="text-input"
              maxLength={40}
              value={form.telefono}
              onChange={(e) => setForm({ ...form, telefono: e.target.value })}
            />
          </label>

          <div className="form-full">
            <p className="field-label">Propiedades</p>
            <div className="checkbox-grid">
              {selectableProperties.map((p) => (
                <label className="checkbox-card" key={p.id}>
                  <input
                    type="checkbox"
                    checked={form.propiedadesPermitidas.includes(p.id)}
                    onChange={() => toggleProperty(p.id)}
                  />
                  <span>
                    <strong>{p.nombre}</strong>
                    <small>{p.codigo || p.id}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <label className="field-label">
            Área
            <input
              className="text-input"
              maxLength={100}
              value={form.area}
              onChange={(e) => setForm({ ...form, area: e.target.value })}
            />
          </label>

          {tab === 'eventual' ? (
            <>
              <label className="field-label">
                Puesto
                <select
                  className="text-input"
                  required
                  value={form.puestoId}
                  onChange={(e) => setForm({ ...form, puestoId: e.target.value })}
                >
                  <option value="">Selecciona un puesto</option>
                  {activeJobs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                {selectedJob && (
                  <span className="helper-text">
                    Tarifa actual del puesto: ${Number(selectedJob.tarifaHora || 0).toFixed(2)} / hora
                  </span>
                )}
              </label>

              <label className="field-label">
                Tarifa especial (opcional)
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.tarifaPersonalizada}
                  onChange={(e) => setForm({ ...form, tarifaPersonalizada: e.target.value })}
                />
                <span className="helper-text">
                  Si queda vacía se utiliza la tarifa actual del puesto.
                </span>
              </label>
            </>
          ) : (
            <>
              <label className="field-label">
                Escuela
                <input
                  className="text-input"
                  required
                  value={form.school}
                  onChange={(e) => setForm({ ...form, school: e.target.value })}
                />
              </label>
              <label className="field-label">
                Carrera
                <input
                  className="text-input"
                  required
                  value={form.career}
                  onChange={(e) => setForm({ ...form, career: e.target.value })}
                />
              </label>
              <label className="field-label">
                Jefe / responsable
                <input
                  className="text-input"
                  required
                  value={form.supervisor}
                  onChange={(e) => setForm({ ...form, supervisor: e.target.value })}
                />
              </label>
              <label className="field-label">
                Fecha inicio
                <input
                  className="text-input"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </label>
              <label className="field-label">
                Fecha fin prevista
                <input
                  className="text-input"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </label>
              <label className="field-label">
                Horas por cumplir
                <input
                  className="text-input"
                  type="number"
                  min="0.1"
                  step="0.1"
                  required
                  value={form.targetHours}
                  onChange={(e) => setForm({ ...form, targetHours: e.target.value })}
                />
              </label>
              <label className="field-label">
                Horas previas reconocidas
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.initialAccumulatedHours}
                  onChange={(e) => setForm({ ...form, initialAccumulatedHours: e.target.value })}
                />
              </label>
            </>
          )}

          <label className="field-label">
            Estado
            <select
              className="text-input"
              value={form.activo ? 'true' : 'false'}
              onChange={(e) => setForm({ ...form, activo: e.target.value === 'true' })}
            >
              <option value="true">Activo</option>
              <option value="false">Inactivo</option>
            </select>
          </label>

          <div className="admin-form-modal-actions form-full">
            <button className="primary-button" disabled={busy}>
              <Save size={16} />
              {busy ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </FormModal>

      <FormModal
        open={Boolean(qrPerson)}
        title="Código QR"
        subtitle="Identificación para registrar entrada y salida."
        onClose={() => setQrPerson(null)}
        width="420px"
      >
        {qrPerson && (
          <div className="qr-person-card" ref={qrRef}>
            <div className="qr-person-badge">
              <div className="qr-brand-panel">
                <img src="/brand/gmr-logo.png" alt="México Real Corporativo" className="qr-corporate-logo" />
              </div>
              <QRCodeCanvas
                value={qrPerson.qr || qrPerson.clave}
                size={220}
                level="M"
                includeMargin
              />
              <h4>{qrPerson.nombre}</h4>
              <span className="qr-role">{qrSubtitle(qrPerson)}</span>
            </div>
            <button type="button" className="primary-button" onClick={downloadQr}>
              Descargar credencial QR
            </button>
          </div>
        )}
      </FormModal>
    </section>
  );
}
