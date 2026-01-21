import { Request, Response, NextFunction } from 'express';
import { verifySignature } from './security';

// Middleware to verify x-casino-signature header

export function verifyCasinoSignature(req: Request, res: Response, next: NextFunction) {
  const signature = req.header('x-casino-signature');
  const secret = process.env.CASINO_SECRET;
  
  if (!secret) {
    console.error('CASINO_SECRET not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  
  if (!verifySignature(signature || '', req.body, secret)) {
    console.warn('Invalid casino signature received');
    return res.status(401).json({
      success: false,
      error: 'Invalid signature',
      code: 'SIGNATURE_INVALID'
    });
  }
  
  next();
}

// Middleware to verify x-provider-signature header

export function verifyProviderSignature(req: Request, res: Response, next: NextFunction) {
  const signature = req.header('x-provider-signature');
  const secret = process.env.PROVIDER_SECRET;
  
  if (!secret) {
    console.error('PROVIDER_SECRET not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  
  if (!verifySignature(signature || '', req.body, secret)) {
    console.warn('Invalid provider signature received');
    return res.status(401).json({
      success: false,
      error: 'Invalid signature',
      code: 'SIGNATURE_INVALID'
    });
  }
  
  next();
}

// Error handling middleware

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', err);
  
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.message || 'An unexpected error occurred';
  
  res.status(statusCode).json({
    success: false,
    error: message,
    code: code
  });
}

// Request logging middleware
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
}
