import { signBody, verifySignature, generateTransactionId, generateRoundId, generateSessionToken } from './security';

describe('Security Module', () => {
  describe('signBody', () => {
    it('should generate consistent signatures for the same payload', () => {
      const body = { test: 'data', amount: 100 };
      const secret = 'test_secret';
      
      const sig1 = signBody(body, secret);
      const sig2 = signBody(body, secret);
      
      expect(sig1).toBe(sig2);
    });

    it('should generate different signatures for different payloads', () => {
      const secret = 'test_secret';
      
      const sig1 = signBody({ amount: 100 }, secret);
      const sig2 = signBody({ amount: 200 }, secret);
      
      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different secrets', () => {
      const body = { test: 'data' };
      
      const sig1 = signBody(body, 'secret1');
      const sig2 = signBody(body, 'secret2');
      
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifySignature', () => {
    it('should verify valid signature', () => {
      const body = { test: 'data', amount: 100 };
      const secret = 'test_secret';
      
      const signature = signBody(body, secret);
      const isValid = verifySignature(signature, body, secret);
      
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const body = { test: 'data' };
      const secret = 'test_secret';
      
      const isValid = verifySignature('invalid_signature', body, secret);
      
      expect(isValid).toBe(false);
    });

    it('should reject empty signature', () => {
      const body = { test: 'data' };
      const secret = 'test_secret';
      
      const isValid = verifySignature('', body, secret);
      
      expect(isValid).toBe(false);
    });

    it('should reject tampered payload', () => {
      const originalBody = { amount: 100 };
      const tamperedBody = { amount: 200 };
      const secret = 'test_secret';
      
      const signature = signBody(originalBody, secret);
      const isValid = verifySignature(signature, tamperedBody, secret);
      
      expect(isValid).toBe(false);
    });
  });

  describe('generateTransactionId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateTransactionId();
      const id2 = generateTransactionId();
      
      expect(id1).not.toBe(id2);
    });

    it('should include prefix', () => {
      const id = generateTransactionId('bet');
      
      expect(id.startsWith('bet_')).toBe(true);
    });

    it('should use default prefix', () => {
      const id = generateTransactionId();
      
      expect(id.startsWith('txn_')).toBe(true);
    });
  });

  describe('generateRoundId', () => {
    it('should generate unique round IDs', () => {
      const id1 = generateRoundId();
      const id2 = generateRoundId();
      
      expect(id1).not.toBe(id2);
    });

    it('should include round prefix', () => {
      const id = generateRoundId();
      
      expect(id.startsWith('round_')).toBe(true);
    });
  });

  describe('generateSessionToken', () => {
    it('should generate unique session tokens', () => {
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();
      
      expect(token1).not.toBe(token2);
    });

    it('should generate tokens of correct length', () => {
      const token = generateSessionToken();
      
      // 32 bytes = 64 hex characters
      expect(token.length).toBe(64);
    });
  });
});
