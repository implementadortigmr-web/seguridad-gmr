import { useEffect, useState } from 'react';
import { obtenerFotoAsistencia, mensajeAsistencia } from '../services/asistenciaService';
import MessageBox from '../../../components/MessageBox';
export default function FotoAsistencia({ path, label }) {
  const [url, setUrl] = useState(''); const [error, setError] = useState('');
  useEffect(() => {
    let alive = true; let objectUrl = '';
    setUrl(''); setError('');
    if (path) obtenerFotoAsistencia(path).then((blob) => {
      if (alive) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch((e) => { if (alive) setError(mensajeAsistencia(e)); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  return <figure className="asistencia-photo"><figcaption>{label}</figcaption>
    {!path ? <p>No hay fotografia para este movimiento.</p> : error ? <MessageBox type="error">{error}</MessageBox> : url ? <img src={url} alt={label} /> : <p>Cargando foto...</p>}
  </figure>;
}
