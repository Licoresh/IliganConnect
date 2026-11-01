import { imageHeaderError } from "@community/shared";

export async function validateImageFile(file: File) {
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error("Choose a non-empty JPG, PNG, or WebP image up to 5 MB.");
  const problem = imageHeaderError(new Uint8Array(await file.slice(0, 12).arrayBuffer()), file.type);
  if (problem) throw new Error(problem);
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file, { resizeWidth: 1600 });
      bitmap.close();
    } else {
      const url = URL.createObjectURL(file);
      try { const image = new Image(); image.src = url; await image.decode(); } finally { URL.revokeObjectURL(url); }
    }
  } catch { throw new Error("This image could not be opened. Choose another photo or export it again as JPG, PNG, or WebP."); }
}
