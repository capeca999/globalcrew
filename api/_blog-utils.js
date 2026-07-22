import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// ---- R2 config (all from Vercel environment variables) ----
// R2_ACCOUNT_ID        -> your Cloudflare account ID
// R2_ACCESS_KEY_ID      -> from an R2 API token (Object Read & Write)
// R2_SECRET_ACCESS_KEY  -> from the same R2 API token
// R2_BUCKET_NAME        -> the bucket name, e.g. "globalcrew"
// R2_PUBLIC_URL         -> the bucket's public base URL, no trailing slash —
//                          either the "pub-xxxx.r2.dev" address Cloudflare
//                          gives you when you enable public access on the
//                          bucket, or your own custom domain if you set one up.
const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_BASE = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

export const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export function publicUrl(key) {
  return `${PUBLIC_BASE}/${key}`;
}

// Mimics the old `list({ prefix })` from @vercel/blob: returns a flat array
// of { pathname, uploadedAt, url }, handling pagination transparently
// (S3-style listing caps out at 1000 keys per page).
export async function listObjects(prefix) {
  const out = [];
  let ContinuationToken;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix || undefined,
      ContinuationToken,
    }));
    (res.Contents || []).forEach((obj) => {
      out.push({ pathname: obj.Key, uploadedAt: obj.LastModified, url: publicUrl(obj.Key) });
    });
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out;
}

// Mimics the old `put(path, body, { contentType })`. R2/S3 always
// overwrites by key — there's no "random suffix" concept to worry about.
export async function putObject(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return { url: publicUrl(key), pathname: key };
}

// Mimics the old `del(path)`. Doesn't throw if the object doesn't exist,
// same forgiving behavior the rest of the code already relies on.
export async function deleteObject(key) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    // fine if it didn't exist
  }
}

export function slugify(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 80);
}

// Public objects are fetched straight from their URL — a normal HTTP
// request, not billed as an R2 "Class A" operation the way list/put/delete are.
export async function fetchPublicText(url) {
  if (!url) return '';
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    return (await res.text()).trim();
  } catch {
    return '';
  }
}

export async function fetchPublicJson(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ===================== WRITE BUDGET CIRCUIT BREAKER =====================
// R2's free tier is 1,000,000 "Class A" operations/month (list/put/delete).
// This tracks how many WRITE operations (put/delete) we've made this
// calendar month, in a small object inside the bucket itself, and refuses
// further writes once we get close to the limit — so a leaked password or
// a scripted abuse of the admin endpoints can't run up a real bill, it just
// makes the panel say "try again next month" instead.
//
// Reading the counter is free (plain fetch on its public URL). Only the
// write-back costs 1 extra Class A operation per protected action — a
// reasonable trade given writes are already rare (an admin publishing or
// editing something), not part of the high-volume public read traffic.
const USAGE_COUNTER_KEY = '_system/usage-counter.json';
const SAFETY_THRESHOLD = 900000; // stop 100k below the real 1,000,000 free-tier cap

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Read-only peek at the current count, without incrementing it — used to
// show Kike the current usage in the admin panel.
export async function peekWriteBudget() {
  const month = currentMonthKey();
  const counter = await fetchPublicJson(publicUrl(USAGE_COUNTER_KEY));
  if (!counter || counter.month !== month) {
    return { count: 0, limit: SAFETY_THRESHOLD };
  }
  return { count: counter.writeCount, limit: SAFETY_THRESHOLD };
}

// Call this at the top of any handler that performs a put/delete. If
// `allowed` comes back false, refuse the request instead of writing.
export async function checkWriteBudget() {
  const month = currentMonthKey();
  let counter = await fetchPublicJson(publicUrl(USAGE_COUNTER_KEY));

  if (!counter || counter.month !== month) {
    counter = { month, writeCount: 0 };
  }

  if (counter.writeCount >= SAFETY_THRESHOLD) {
    return { allowed: false, count: counter.writeCount, limit: SAFETY_THRESHOLD };
  }

  counter.writeCount += 1;
  counter.updatedAt = new Date().toISOString();
  try {
    await putObject(USAGE_COUNTER_KEY, JSON.stringify(counter), 'application/json');
  } catch {
    // If bookkeeping itself fails, don't block the person's action over it —
    // fail open rather than lock out the admin panel over a glitch.
  }
  return { allowed: true, count: counter.writeCount, limit: SAFETY_THRESHOLD };
}
