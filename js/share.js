// Trainee share links: the schedule is compressed into the URL hash, so no server read access is needed.

const toB64Url = (bytes) => {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return toB64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
}
export async function decodeShare(str) {
  const bytes = await pipe(fromB64Url(str), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}
