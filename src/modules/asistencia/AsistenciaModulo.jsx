import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Capacitor } from '@capacitor/core';
import { MapPin, RefreshCcw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import MessageBox from '../../components/MessageBox';
import {
  puedeRegistrarAsistencia,
  tieneModuloAsistencia,
} from '../../../shared/asistenciaDomain';
import {
  listarPropiedadesAsistencia,
  mensajeAsistencia,
} from './services/asistenciaService';
import { leerBorrador } from './services/borradorService';
import './asistencia.css';

const RegistroAsistencia = lazy(() =>
  import('./components/RegistroAsistencia')
);

function normalizar(valor = '') {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function esMexico(propiedad) {
  return normalizar(
    `${propiedad?.codigo || ''} ${propiedad?.nombre || ''}`
  ).includes('MEXICO');
}

export default function AsistenciaModulo({
  soloMexico = false,
}) {
  const { profile } = useAuth();

  const native =
    Capacitor.isNativePlatform();

  const registro =
    native &&
    puedeRegistrarAsistencia(profile);

  const modoMexico =
    soloMexico ||
    profile?.rol === 'asistencia';

  const [properties, setProperties] =
    useState([]);

  const [selected, setSelected] =
    useState('');

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState('');

  const [pending, setPending] =
    useState(false);

  const uid =
    profile?.id || profile?.uid;

  const visibleProperties = useMemo(
    () => {
      if (modoMexico) {
        return properties.filter(esMexico);
      }

      return properties.filter(
        (property) =>
          !esMexico(property)
      );
    },
    [properties, modoMexico]
  );

  const cargar = useCallback(
    async () => {
      setRefreshing(true);
      setError('');

      try {
        const items =
          await listarPropiedadesAsistencia(
            profile
          );

        const draft =
          native && uid
            ? await leerBorrador(uid)
            : null;

        setProperties(items);

        const allowed = modoMexico
          ? items.filter(esMexico)
          : items.filter(
              (property) =>
                !esMexico(property)
            );

        setSelected((previous) => {
          if (
            draft &&
            allowed.some(
              (property) =>
                property.id ===
                draft.propiedadId
            )
          ) {
            return draft.propiedadId;
          }

          if (
            allowed.some(
              (property) =>
                property.id ===
                previous
            )
          ) {
            return previous;
          }

          return allowed.length === 1
            ? allowed[0].id
            : '';
        });
      } catch (e) {
        setError(
          mensajeAsistencia(e)
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      profile,
      native,
      uid,
      modoMexico,
    ]
  );

  useEffect(() => {
    if (
      profile &&
      tieneModuloAsistencia(profile)
    ) {
      cargar();
    }
  }, [profile, cargar]);

  if (
    !tieneModuloAsistencia(profile)
  ) {
    return (
      <p>No tienes acceso a Asistencia.</p>
    );
  }

  if (!native || !registro) {
    return (
      <p className="asistencia-note">
        El registro de entradas y salidas se realiza
        únicamente desde la APK.
      </p>
    );
  }

  const propiedad =
    visibleProperties.find(
      (property) =>
        property.id === selected
    );

  return (
    <div
      className={`asistencia-module ${
        modoMexico
          ? 'asistencia-module-mexico'
          : ''
      }`}
    >
      {!modoMexico && (
        <div className="asistencia-heading">
          <div>
            <p className="asistencia-eyebrow">
              Seguridad GMR
            </p>
            <h1>Asistencia</h1>
          </div>

          <button
            type="button"
            onClick={cargar}
            disabled={
              loading ||
              refreshing ||
              pending
            }
          >
            <RefreshCcw size={16} />
            {refreshing
              ? 'Actualizando...'
              : 'Actualizar'}
          </button>
        </div>
      )}

      {error && <MessageBox type="error">{error}</MessageBox>}

      {loading ? (
        <div className="asistencia-simple-loading">
          <div className="pdf-loading-spinner" />
          <span>Cargando asistencia...</span>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="asistencia-simple-loading">
              <div className="pdf-loading-spinner" />
              <span>Cargando registro...</span>
            </div>
          }
        >
          {!modoMexico &&
          visibleProperties.length > 1 ? (
            <div className="asistencia-property-grid">
              {visibleProperties.map(
                (property) => (
                  <button
                    type="button"
                    key={property.id}
                    className={`asistencia-property-card ${
                      selected ===
                      property.id
                        ? 'active'
                        : ''
                    }`}
                    disabled={pending}
                    onClick={() =>
                      setSelected(
                        property.id
                      )
                    }
                  >
                    <MapPin size={18} />
                    <span>
                      {property.nombre}
                    </span>
                  </button>
                )
              )}
            </div>
          ) : null}

          {propiedad ? (
            <RegistroAsistencia
              key={`${uid}:${propiedad.id}`}
              profile={profile}
              propiedad={propiedad}
              onPendiente={setPending}
            />
          ) : visibleProperties.length >
            1 ? (
            <p className="asistencia-note">
              Selecciona una propiedad para comenzar.
            </p>
          ) : (
            <p className="asistencia-note">
              No hay propiedades disponibles para este perfil.
            </p>
          )}
        </Suspense>
      )}
    </div>
  );
}
