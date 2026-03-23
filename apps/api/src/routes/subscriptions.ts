import { Router } from 'express';
import { prisma } from '../storage/prisma.js';
import { logger } from '../utils/logger.js';

export const subscriptionRouter = Router();

// ── Gumroad Webhook ────────────────────────────────────────────────────────
// Gumroad posts application/x-www-form-urlencoded to this endpoint
// on every sale, refund, subscription cancellation, etc.
// Docs: https://gumroad.com/ping
// Set in Gumroad → Settings → Advanced → Ping URL:
//   https://your-app.azurewebsites.net/api/webhooks/gumroad
// ──────────────────────────────────────────────────────────────────────────
subscriptionRouter.post('/webhooks/gumroad', async (req, res) => {
  try {
    const body = req.body as Record<string, string>;

    const email      = (body.email ?? '').toLowerCase().trim();
    const saleId     = body.sale_id ?? body.subscription_id ?? '';
    const eventType  = body.resource_name ?? 'sale';  // sale | refund | subscription_ended | subscription_restarted
    const cancelled  = body.subscription_cancelled === 'true';
    const refunded   = body.refunded === 'true';

    logger.info({ email, saleId, eventType, cancelled, refunded }, 'Gumroad webhook received');

    if (!email) {
      res.status(400).json({ ok: false, message: 'Missing email' });
      return;
    }

    // Determine status
    const isActive = !cancelled && !refunded && eventType !== 'subscription_ended';
    const status   = isActive ? 'active' : 'cancelled';

    // Upsert — create or update the subscription record
    await prisma.subscription.upsert({
      where:  { email },
      update: {
        status,
        gumroadSaleId: saleId || undefined,
        updatedAt: new Date(),
        // For monthly subs, set expiresAt 35 days out (5-day grace period)
        expiresAt: isActive ? new Date(Date.now() + 35 * 24 * 60 * 60 * 1000) : new Date(),
      },
      create: {
        email,
        gumroadSaleId: saleId || undefined,
        status,
        subscribedAt: new Date(),
        updatedAt: new Date(),
        expiresAt: isActive ? new Date(Date.now() + 35 * 24 * 60 * 60 * 1000) : new Date(),
      },
    });

    logger.info({ email, status }, 'Subscription upserted');
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Gumroad webhook error');
    res.status(500).json({ ok: false, message: 'Internal error' });
  }
});

// ── Check subscription status (called by frontend) ────────────────────────
// GET /api/subscription/status
// Returns { subscribed: boolean } for the currently logged-in user
subscriptionRouter.get('/subscription/status', async (req: any, res) => {
  try {
    const upn = (req.session?.account?.username ?? '').toLowerCase().trim();

    if (!upn) {
      res.json({ subscribed: false });
      return;
    }

    // Exempt emails — always subscribed
    const EXEMPT = [
      'menahem@365-poc.com',
      'menahem@modernendpoint.tech',
    ];
    if (EXEMPT.includes(upn)) {
      res.json({ subscribed: true });
      return;
    }

    const sub = await prisma.subscription.findUnique({ where: { email: upn } });

    if (!sub || sub.status !== 'active') {
      res.json({ subscribed: false });
      return;
    }

    // Check expiry
    if (sub.expiresAt && sub.expiresAt < new Date()) {
      res.json({ subscribed: false });
      return;
    }

    res.json({ subscribed: true });
  } catch (err) {
    logger.error({ err }, 'Subscription status check error');
    res.json({ subscribed: false });
  }
});

// ── Admin: manually add/remove a subscriber ───────────────────────────────
// POST /api/subscription/admin  { email, action: 'add' | 'remove' }
// Protected — only works from authenticated session of exempt users
subscriptionRouter.post('/subscription/admin', async (req: any, res) => {
  const callerUpn = (req.session?.account?.username ?? '').toLowerCase().trim();
  const EXEMPT = ['menahem@365-poc.com', 'menahem@modernendpoint.tech'];

  if (!EXEMPT.includes(callerUpn)) {
    res.status(403).json({ ok: false, message: 'Forbidden' });
    return;
  }

  const { email, action } = req.body as { email: string; action: 'add' | 'remove' };
  const normalized = (email ?? '').toLowerCase().trim();

  if (!normalized) {
    res.status(400).json({ ok: false, message: 'Missing email' });
    return;
  }

  try {
    if (action === 'add') {
      await prisma.subscription.upsert({
        where:  { email: normalized },
        update: { status: 'active', expiresAt: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000), updatedAt: new Date() },
        create: { email: normalized, status: 'active', subscribedAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000) },
      });
      res.json({ ok: true, message: `${normalized} added as subscriber` });
    } else {
      await prisma.subscription.updateMany({
        where: { email: normalized },
        data:  { status: 'cancelled', updatedAt: new Date() },
      });
      res.json({ ok: true, message: `${normalized} subscription cancelled` });
    }
  } catch (err) {
    logger.error({ err }, 'Admin subscription error');
    res.status(500).json({ ok: false });
  }
});
