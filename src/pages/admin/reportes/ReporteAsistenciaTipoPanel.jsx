import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';
import DataLoadingState from '../../../components/DataLoadingState';
import ReportesAsistencia from '../../../modules/asistencia/components/ReportesAsistencia';
import ReporteSemanalEventuales from './ReporteSemanalEventuales';
import MessageBox from '../../../components/MessageBox';
import {
  listarPropiedadesAsistencia,
  mensajeAsistencia,
} from '../../../modules/asistencia/services/asistenciaService';

const titles = {
  eventual: 'Reporte de Eventuales',
  practicante: 'Reporte de Practicantes',
  personal_mexico: 'Asistencia México',
};

function normalizar(valor = '') {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function esMexico(propiedad) {
  return normalizar(`${propiedad?.codigo || ''} ${propiedad?.nombre || ''}`).includes('MEXICO');
}

export default function ReporteAsistenciaTipoPanel({ tipoPersonal }) {
  const { profile } = useAuth();
  const [properties, setProperties] = useState([]);
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessage('');

    listarPropiedadesAsistencia(profile)
      .then((rows) => {
        if (!alive) return;

        const filtered = tipoPersonal === 'personal_mexico'
          ? rows.filter(esMexico)
          : rows.filter((property) => !esMexico(property));

        setProperties(filtered);
        setSelected((old) =>
          filtered.some((property) => property.id === old)
            ? old
            : filtered[0]?.id || ''
        );
      })
      .catch((error) => {
        if (alive) setMessage(mensajeAsistencia(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [profile, tipoPersonal]);

  const property = useMemo(
    () => properties.find((item) => item.id === selected) || null,
    [properties, selected]
  );

  return (
    <section>
      <h2>{titles[tipoPersonal] || 'Asistencia'}</h2>
      <p className="muted admin-intro">
        Consulta por propiedad, empleado, periodo y estado. Los resultados se cargan por páginas para evitar descargar todo el historial.
      </p>

      {message && <MessageBox>{message}</MessageBox>}

      {loading ? (
        <DataLoadingState
          title="Cargando propiedades..."
          detail="Preparando el reporte de asistencia."
        />
      ) : (
        <>
          {properties.length > 1 && (
            <label className="field-label report-property-picker">
              Propiedad
              <select
                className="text-input"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                {properties.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}

          {property ? (
            tipoPersonal === 'eventual' ? (
              <ReporteSemanalEventuales
                key={`eventual-semanal:${property.id}`}
                propiedad={property}
              />
            ) : (
              <ReportesAsistencia
                key={`${tipoPersonal}:${property.id}`}
                profile={profile}
                propiedad={property}
                tipoPersonal={tipoPersonal}
              />
            )
          ) : (
            <div className="empty-state">
              No hay propiedades disponibles para este reporte.
            </div>
          )}
        </>
      )}
    </section>
  );
}
