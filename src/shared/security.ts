import crypto from 'crypto';

// Sign request body with HMAC-SHA256
export function signBody(body: any, secret: string): string {
  const payload = JSON.stringify(body);
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

// Verify signature matches the body
export function verifySignature(providedSig: string, body: any, secret: string): boolean {
  if (!providedSig) return false;
  
  const expectedSig = signBody(body, secret);
  
  // constant-time comparison
  try {
    const a = Buffer.from(providedSig, 'hex');
    const b = Buffer.from(expectedSig, 'hex');
    
    if (a.length !== b.length) return false;
    
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Generate unique transaction ID
export function generateTransactionId(prefix: string = 'txn'): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

// Generate a unique round ID
export function generateRoundId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(6).toString('hex');
  return `round_${timestamp}_${random}`;
}

// Generate a unique session token
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
