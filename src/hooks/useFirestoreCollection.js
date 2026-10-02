import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '../services/firebase';

const EMPTY_ITEMS = [];

export function useFirestoreCollectionState(
  collectionName,
  orderField = '',
  enabled = true
) {
  const key = `${collectionName}:${orderField}`;
  const [result, setResult] = useState({
    key: '',
    items: EMPTY_ITEMS,
    loading: enabled,
    error: null,
  });

  useEffect(() => {
    if (!enabled) {
      setResult({
        key: '',
        items: EMPTY_ITEMS,
        loading: false,
        error: null,
      });
      return undefined;
    }

    let active = true;
    setResult((current) => ({
      key,
      items: current.key === key ? current.items : EMPTY_ITEMS,
      loading: true,
      error: null,
    }));

    const source = collection(db, collectionName);
    const request = orderField
      ? query(source, orderBy(orderField))
      : query(source);

    const unsubscribe = onSnapshot(
      request,
      (snapshot) => {
        if (!active) return;
        setResult({
          key,
          items: snapshot.docs.map((document) => ({
            id: document.id,
            ...document.data(),
          })),
          loading: false,
          error: null,
        });
      },
      (error) => {
        if (!active) return;
        console.error(`Error leyendo colección ${collectionName}:`, error);
        setResult({
          key,
          items: EMPTY_ITEMS,
          loading: false,
          error,
        });
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [collectionName, orderField, enabled, key]);

  return useMemo(() => {
    if (!enabled) {
      return { items: EMPTY_ITEMS, loading: false, error: null };
    }
    if (result.key !== key) {
      return { items: EMPTY_ITEMS, loading: true, error: null };
    }
    return {
      items: result.items,
      loading: result.loading,
      error: result.error,
    };
  }, [enabled, key, result]);
}

export default function useFirestoreCollection(
  collectionName,
  orderField = '',
  enabled = true
) {
  return useFirestoreCollectionState(
    collectionName,
    orderField,
    enabled
  ).items;
}
