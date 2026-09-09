import { Request } from 'express';
import { AuditLog } from '../models';

interface AuditInput {
  req?: Request;
  action: string;
  entityType: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** Fire-and-forget audit write — never block or fail a request because of logging. */
export async function recordAudit({
  req,
  action,
  entityType,
  entityId,
  before,
  after,
}: AuditInput): Promise<void> {
  try {
    await AuditLog.create({
      actor: req?.user?.id,
      actorEmail: req?.user?.email,
      actorRole: req?.user?.role,
      action,
      entityType,
      entityId,
      before,
      after,
      ip: req?.ip,
      userAgent: req?.get('user-agent'),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to write log', err);
  }
}
