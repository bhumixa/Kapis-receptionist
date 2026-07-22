import { Request } from 'express';
import { AccessTokenPayload } from '../../application/token.service';

export interface AuthenticatedRequest extends Request {
  user: AccessTokenPayload;
}
