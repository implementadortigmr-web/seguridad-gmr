import Dexie from 'dexie';
import { getApp } from 'firebase/app';

// Separate DB; it never upgrades, clears or renames the patrols' existing DB.
const draftDb = new Dexie('gmrAsistenciaBorradoresV1');
draftDb.version(1).stores({ borradores: '&id, usuarioId' });
const id = (uid) => `${getApp().options.projectId}:${uid}`;
export const leerBorrador = (uid) => draftDb.borradores.get(id(uid));
export const guardarBorrador = (uid, draft) => draftDb.borradores.put({ ...draft, id: id(uid), usuarioId: uid });
export const quitarBorrador = (uid) => draftDb.borradores.delete(id(uid));
