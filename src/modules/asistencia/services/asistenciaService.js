import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';

import {
  getFunctions,
  httpsCallable,
} from 'firebase/functions';

import { getApp } from 'firebase/app';

import {
  getBlob,
  ref,
  uploadBytesResumable,
} from 'firebase/storage';

import {
  db,
  storage,
} from '../../../services/firebase';

import {
  permisosPropiedades,
  puedeVerPropiedad,
  MAX_FOTO_BYTES,
} from '../../../../shared/asistenciaDomain';

const functions = getFunctions(
  getApp(),
  import.meta.env
    .VITE_ASISTENCIA_FUNCTIONS_REGION ||
    'us-central1'
);

export async function llamarAsistencia(
  nombre,
  data = {}
) {
  const response = await httpsCallable(
    functions,
    nombre,
    {
      timeout: 60000,
    }
  )(data);

  return response.data;
}

export function mensajeAsistencia(error) {
  const code = String(error?.code || '');
  const message = String(
    error?.message || ''
  );

  console.error('AsistenciaError', {
    code,
    message,
    details: error?.details || null,
  });

  if (
    /PIN incorrecto/i.test(message)
  ) {
    return 'PIN incorrecto.';
  }

  if (
    /Vuelve a ingresar la clave y el PIN/i.test(
      message
    )
  ) {
    return 'La validación venció. Cancela el registro e ingresa nuevamente la clave y el PIN.';
  }

  if (
    /no tiene PIN configurado/i.test(
      message
    )
  ) {
    return 'Este empleado todavía no tiene PIN configurado.';
  }

  if (
    code === 'functions/internal' ||
    message === 'internal'
  ) {
    return error?.details?.referencia
      ? `No fue posible registrar la asistencia. Referencia: ${error.details.referencia}`
      : 'No fue posible registrar la asistencia.';
  }

  if (
    /unavailable|network|deadline-exceeded/.test(
      code
    )
  ) {
    return 'No se pudo conectar con el servicio. Intenta nuevamente.';
  }

  if (
    code === 'storage/unauthorized'
  ) {
    return 'No fue posible guardar la fotografía.';
  }

  if (
    code === 'storage/canceled'
  ) {
    return 'La carga de la fotografía fue cancelada.';
  }

  if (code.startsWith('storage/')) {
    return 'Ocurrió un problema al guardar la fotografía.';
  }

  if (
    code ===
    'functions/permission-denied'
  ) {
    return message &&
      !message.includes(
        'permission-denied'
      )
      ? message
      : 'Esta cuenta no tiene permiso para registrar asistencia.';
  }

  if (
    code === 'failed-precondition' &&
    /index/i.test(message)
  ) {
    return 'El reporte necesita un índice de Firestore. Publica firestore.indexes.json y vuelve a consultar cuando el índice termine de crearse.';
  }

  if (
    code === 'functions/not-found'
  ) {
    return (
      message ||
      'El servicio de asistencia no está disponible.'
    );
  }

  return (
    message ||
    'No fue posible completar la operación.'
  );
}

export async function listarPropiedadesAsistencia(
  profile
) {
  const permisos =
    permisosPropiedades(profile);

  let docs;

  if (
    profile.rol === 'administrador' ||
    permisos.includes('*')
  ) {
    docs = (
      await getDocsFromServer(
        collection(
          db,
          'propiedades'
        )
      )
    ).docs;
  } else {
    docs = await Promise.all(
      permisos.map((id) =>
        getDocFromServer(
          doc(
            db,
            'propiedades',
            id
          )
        )
      )
    );
  }

  return docs
    .filter((item) => item.exists())
    .map((item) => ({
      ...item.data(),
      id: item.id,
    }))
    .filter(
      (property) =>
        puedeVerPropiedad(
          profile,
          property.id
        ) &&
        property.activo === true
    )
    .sort((a, b) =>
      String(a.nombre).localeCompare(
        String(b.nombre),
        'es'
      )
    );
}

export async function subirFotoAsistencia({
  borrador,
  uid,
  onProgress,
}) {
  if (!borrador?.propiedadId) {
    throw new Error(
      'No se encontró la propiedad del registro.'
    );
  }

  if (!borrador?.empleado?.id) {
    throw new Error(
      'No se encontró el empleado del registro.'
    );
  }

  if (!uid) {
    throw new Error(
      'No se encontró el usuario autenticado.'
    );
  }

  if (!borrador?.solicitudId) {
    throw new Error(
      'No se encontró el folio de la operación.'
    );
  }

  const blob = borrador.foto;

  if (!(blob instanceof Blob)) {
    throw new Error(
      'No se recibió una fotografía válida.'
    );
  }

  if (blob.size <= 0) {
    throw new Error(
      'La fotografía está vacía.'
    );
  }

  if (blob.size > MAX_FOTO_BYTES) {
    throw new Error(
      'La fotografía supera el tamaño permitido.'
    );
  }

  const tipo = String(
    blob.type || ''
  ).toLowerCase();

  if (
    tipo !== 'image/jpeg' &&
    tipo !== 'image/jpg'
  ) {
    throw new Error(
      `Formato de fotografía no válido: ${
        blob.type || 'desconocido'
      }`
    );
  }

  const path =
    `asistencia/` +
    `${borrador.propiedadId}/` +
    `${borrador.empleado.id}/` +
    `${uid}/` +
    `${borrador.solicitudId}.jpg`;

  const evidenciaRef = ref(
    storage,
    path
  );

  await new Promise(
    (resolve, reject) => {
      const task =
        uploadBytesResumable(
          evidenciaRef,
          blob,
          {
            contentType:
              'image/jpeg',

            customMetadata: {
              registradoPor: uid,
              empleadoId:
                borrador.empleado.id,
              solicitudId:
                borrador.solicitudId,
              propiedadId:
                borrador.propiedadId,
            },
          }
        );

      const timer = setTimeout(
        () => {
          task.cancel();
        },
        45000
      );

      task.on(
        'state_changed',

        (snapshot) => {
          const porcentaje =
            snapshot.totalBytes > 0
              ? Math.round(
                  (snapshot.bytesTransferred /
                    snapshot.totalBytes) *
                    100
                )
              : 0;

          onProgress?.(porcentaje);
        },

        (error) => {
          clearTimeout(timer);

          console.error(
            'ErrorFotoAsistencia',
            {
              code: error?.code,
              message:
                error?.message,
            }
          );

          reject(error);
        },

        () => {
          clearTimeout(timer);
          resolve();
        }
      );
    }
  );

  return path;
}

export async function obtenerFotoAsistencia(
  path
) {
  if (
    typeof path !== 'string' ||
    !path.startsWith(
      'asistencia/'
    )
  ) {
    throw new Error(
      'Ruta de evidencia no válida.'
    );
  }

  return getBlob(
    ref(storage, path),
    MAX_FOTO_BYTES
  );
}

export async function listarPersonal(
  propiedadId,
  tipo = ''
) {
  const response = await llamarAsistencia(
    'asistenciaListarPersonal',
    {
      propiedadId,
      tipo,
    }
  );

  return Array.isArray(response?.rows)
    ? response.rows
    : [];
}

export async function consultarJornadas({
  propiedadId,
  desde,
  hasta,
  empleadoId,
  estado,
  tipoPersonal = '',
  cursor,
  pageSize = 50,
}) {
  if (
    !propiedadId ||
    !desde ||
    !hasta ||
    desde > hasta
  ) {
    throw new Error(
      'Selecciona propiedad y un rango de fechas válido.'
    );
  }

  const constraints = [
    where(
      'propiedadId',
      '==',
      propiedadId
    ),

    where(
      'fechaJornada',
      '>=',
      desde
    ),

    where(
      'fechaJornada',
      '<=',
      hasta
    ),
  ];

  if (empleadoId) {
    constraints.push(
      where(
        'empleadoId',
        '==',
        empleadoId
      )
    );
  }

  if (estado) {
    constraints.push(
      where(
        'estado',
        '==',
        estado
      )
    );
  }

  if (tipoPersonal) {
    constraints.push(
      where(
        'tipoPersonal',
        '==',
        tipoPersonal
      )
    );
  }

  constraints.push(
    orderBy(
      'fechaJornada',
      'desc'
    ),

    orderBy(
      documentId(),
      'desc'
    ),

    limit(pageSize)
  );

  if (cursor) {
    constraints.push(
      startAfter(cursor)
    );
  }

  const snap =
    await getDocsFromServer(
      query(
        collection(
          db,
          'asistenciaJornadas'
        ),
        ...constraints
      )
    );

  return {
    rows: snap.docs.map(
      (item) => ({
        ...item.data(),
        id: item.id,
      })
    ),

    cursor:
      snap.docs.at(-1) || null,

    more:
      snap.size === pageSize,
  };
}

export async function exportarTodasJornadas(
  filtros
) {
  let cursor = null;
  const rows = [];

  do {
    const page =
      await consultarJornadas({
        ...filtros,
        cursor,
        pageSize: 200,
      });

    rows.push(...page.rows);

    if (rows.length > 5000) {
      throw new Error(
        'El reporte supera 5000 filas. Reduce el rango de fechas.'
      );
    }

    if (!page.more) {
      return rows;
    }

    cursor = page.cursor;
  } while (cursor);

  return rows;
}
