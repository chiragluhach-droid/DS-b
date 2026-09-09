import { Role } from '../models/types';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
        email: string;
        restaurant?: string;
        ngo?: string;
      };
    }
  }
}

export {};
