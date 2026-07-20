function getSafeFileName(fileName = "foto.jpg", suffix = "") {
  const baseName = fileName.replace(/\.\w+$/, "");
  return `${baseName}${suffix}.jpg`;
}

export async function resizeImage(file, options = {}) {
  const {
    maxWidth = 900,
    maxHeight = 900,
    quality = 0.62,
    suffix = "",
  } = options;

  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = image;

      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("No fue posible procesar la imagen."));
        return;
      }

      context.drawImage(image, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("No fue posible comprimir la imagen."));
            return;
          }

          resolve(
            new File([blob], getSafeFileName(file.name, suffix), {
              type: "image/jpeg",
              lastModified: Date.now(),
            })
          );
        },
        "image/jpeg",
        quality
      );
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No fue posible leer la imagen."));
    };

    image.src = objectUrl;
  });
}

export function compressImage(file) {
  return resizeImage(file, {
    maxWidth: 900,
    maxHeight: 900,
    quality: 0.62,
  });
}

export function createThumbnail(file) {
  return resizeImage(file, {
    maxWidth: 640,
    maxHeight: 640,
    quality: 0.55,
    suffix: "_thumb",
  });
}