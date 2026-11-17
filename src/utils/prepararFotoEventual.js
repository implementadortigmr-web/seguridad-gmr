export async function prepararFotoEventual(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Selecciona una fotografía JPG, PNG o WebP.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Esta imagen es demasiado grande (máximo 12 MB).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('No se pudo leer la fotografía.'));
      i.src = url;
    });
    if (img.width < 150 || img.height < 150) throw new Error('Usa una fotografía más clara, con mayor resolución.');
    const max = 700; const factor = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * factor); canvas.height = Math.round(img.height * factor);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.68, 0.55, 0.4]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if ((data.length - 'data:image/jpeg;base64,'.length) * 3 / 4 <= 250 * 1024) return data;
    }
    throw new Error('No se pudo comprimir la fotografía. Prueba con otra imagen.');
  } finally { URL.revokeObjectURL(url); }
}
