import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import CryptoJS from 'crypto-js';
import { getStorageClient } from './firebase';

function arrayBufferToWordArray(buf: ArrayBuffer): CryptoJS.lib.WordArray {
  const u8 = new Uint8Array(buf);
  const n = u8.length;
  const words: number[] = [];
  for (let i = 0; i < n; i++) {
    words[i >>> 2] |= u8[i] << (24 - (i % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, n);
}

export async function computeImageFileMd5Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const wa = arrayBufferToWordArray(buf);
  return CryptoJS.MD5(wa).toString();
}

export async function uploadOrderPaymentImage(params: {
  shopId: string;
  orderId: string;
  file: File;
}): Promise<string> {
  const { file } = params;
  const rawExt = file.name.split('.').pop()?.toLowerCase() ?? '';
  const safeExt =
    rawExt && /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'jpg';
  const name = `${globalThis.crypto.randomUUID()}.${safeExt}`;
  const path = `paymentScreenshots/${params.shopId}/${params.orderId}/${name}`;
  const storageRef = ref(getStorageClient(), path);
  const contentType =
    file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
  await uploadBytes(storageRef, file, { contentType });
  return getDownloadURL(storageRef);
}

/** 按下载 URL 删除 Storage 对象（尽力而为，规则不允许时可忽略上层错误） */
export async function deleteFileByDownloadUrl(downloadUrl: string): Promise<void> {
  const trimmed = downloadUrl.trim();
  if (!trimmed) return;
  const storageRef = ref(getStorageClient(), trimmed);
  await deleteObject(storageRef);
}
