import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "../services/firebase";

export default function useFirestoreCollection(collectionName, orderField = "") {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let collectionQuery;

    if (orderField) {
      collectionQuery = query(
        collection(db, collectionName),
        orderBy(orderField)
      );
    } else {
      collectionQuery = query(collection(db, collectionName));
    }

    const unsubscribe = onSnapshot(
      collectionQuery,
      (snapshot) => {
        const data = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        setItems(data);
      },
      (error) => {
        console.error(`Error leyendo colección ${collectionName}:`, error);
        setItems([]);
      }
    );

    return () => unsubscribe();
  }, [collectionName, orderField]);

  return items;
}